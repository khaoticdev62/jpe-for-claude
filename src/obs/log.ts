/**
 * JPE's own event log: a short, bounded, redacted record of things worth knowing about, chiefly hook failures that would
 * otherwise be invisible because hooks fail open.
 *
 * It holds a level, a source (such as "hook:PostToolUse"), and one line of text with secrets removed. It never holds
 * prompts, file contents, tool output or stack traces. Whether an entry is written depends on `runtime.logLevel`.
 *
 * Pure: no file access.
 */

import { redactSecrets } from "../core/redact.js";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const MAX_LOG_ENTRIES = 500;
export const MAX_MESSAGE_CHARS = 300;
const MAX_SOURCE_CHARS = 60;

export interface LogEntry {
  at: string;
  level: LogLevel;
  source: string;
  message: string;
}

const rank = (level: LogLevel): number => LOG_LEVELS.indexOf(level);

/** Whether an entry of `level` is written when the configured level is `configured`. Errors are always written. */
export const shouldLog = (configured: LogLevel, level: LogLevel): boolean => level === "error" || rank(level) >= rank(configured);

const isLevel = (v: unknown): v is LogLevel => typeof v === "string" && (LOG_LEVELS as readonly string[]).includes(v);

/** One line of safe text: secrets removed, control characters and line breaks replaced, length limited. */
export function cleanLogText(raw: string, max: number): string {
  const redacted = redactSecrets(raw);
  return Array.from(redacted)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) ? " " : ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function makeLogEntry(input: { at: Date; level: LogLevel; source: string; message: string }): LogEntry {
  return { at: input.at.toISOString(), level: input.level, source: cleanLogText(input.source, MAX_SOURCE_CHARS) || "jpe", message: cleanLogText(input.message, MAX_MESSAGE_CHARS) };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One stored line back into an entry, or undefined when it is not a valid one. Never throws. */
export function parseLogEntry(line: string): LogEntry | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;
  const { at, level, source, message } = raw;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at)) || !isLevel(level) || typeof source !== "string" || source === "" || typeof message !== "string") return undefined;
  return { at, level, source: cleanLogText(source, MAX_SOURCE_CHARS), message: cleanLogText(message, MAX_MESSAGE_CHARS) };
}

export function parseLog(text: string): LogEntry[] {
  return text.split(/\r?\n/).flatMap((line) => (line.trim() === "" ? [] : [parseLogEntry(line) ?? []].flat()));
}

export const serializeLogEntry = (entry: LogEntry): string => `${JSON.stringify(entry)}\n`;

/** The stored text trimmed to the most recent entries, with damaged lines dropped. */
export function trimLog(text: string): string {
  const entries = parseLog(text).slice(-MAX_LOG_ENTRIES);
  return entries.length === 0 ? "" : `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

/** Entries at or above `minimum`, newest first, at most `limit`. */
export function recentEntries(entries: readonly LogEntry[], minimum: LogLevel, limit: number): LogEntry[] {
  return entries.filter((e) => rank(e.level) >= rank(minimum)).slice(-Math.max(1, limit)).reverse();
}

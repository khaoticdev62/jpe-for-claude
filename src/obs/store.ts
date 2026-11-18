import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { CliContext } from "../cli/context.js";
import { type LogEntry, type LogLevel, makeLogEntry, parseLog, serializeLogEntry, shouldLog, trimLog } from "./log.js";

export const LOG_FILE = "events.jsonl";
const PRUNE_ABOVE_LINES = 600;
/** Logging gives up after this long. The thing that made a hook slow may be the same thing logging would wait on. */
const LOG_DEADLINE_MS = 500;

const fileFor = (ctx: Pick<CliContext, "stateDir">): string => path.join(ctx.stateDir(), LOG_FILE);

/**
 * Writes one event if the configured log level allows it. It can never fail or stall the caller: logging is for the
 * person's benefit and must not break a hook, so any problem writing it is swallowed, and it gives up after half a second.
 */
export async function logEvent(ctx: CliContext, level: LogLevel, source: string, message: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, LOG_DEADLINE_MS);
  });
  try {
    await Promise.race([writeEvent(ctx, level, source, message), giveUp]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeEvent(ctx: CliContext, level: LogLevel, source: string, message: string): Promise<void> {
  try {
    const configured = await ctx.loadConfig().then((c) => c.runtime.logLevel, () => "info" as const);
    if (!shouldLog(configured, level)) return;
    const file = fileFor(ctx);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, serializeLogEntry(makeLogEntry({ at: ctx.now(), level, source, message })), "utf8");
  } catch {
    // never let logging break anything
  }
}

/** Every readable event for this project, oldest first. A missing or damaged file reads as no events. */
export async function loadLog(ctx: Pick<CliContext, "stateDir" | "readText">): Promise<LogEntry[]> {
  const text = await ctx.readText(fileFor(ctx)).catch(() => undefined);
  return text === undefined ? [] : parseLog(text);
}

/** Trims the log to the most recent entries. Run when a session starts. */
export async function pruneLog(ctx: Pick<CliContext, "stateDir" | "readText" | "writeText">): Promise<void> {
  const text = await ctx.readText(fileFor(ctx)).catch(() => undefined);
  if (text === undefined || text.split("\n").length <= PRUNE_ABOVE_LINES) return;
  await ctx.writeText(fileFor(ctx), trimLog(text));
}

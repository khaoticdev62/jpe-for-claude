import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CliContext } from "../cli/context.js";
import { safeSessionId } from "./payload.js";

const stateSchema = z.strictObject({
  startedAt: z.iso.datetime(),
  promptNudged: z.boolean(),
  stopNudged: z.boolean(),
  /** file key -> ISO time of the last edit JPE saw */
  edits: z.record(z.string(), z.iso.datetime()),
  /** file key -> id of the backup taken before the first edit */
  backups: z.record(z.string(), z.string()),
  /** file key -> content hash already checked for diagnostics */
  checked: z.record(z.string(), z.string()),
  diagnosticsRuns: z.number().int().min(0),
});

export type SessionState = z.infer<typeof stateSchema>;

const MAX_ENTRIES = 500;
const STALE_MS = 7 * 24 * 3_600_000;

export const fileKey = (file: string): string => (process.platform === "win32" ? path.normalize(file).toLowerCase() : path.normalize(file));

export function freshState(ctx: CliContext): SessionState {
  return { startedAt: ctx.now().toISOString(), promptNudged: false, stopNudged: false, edits: {}, backups: {}, checked: {}, diagnosticsRuns: 0 };
}

const stateFile = (ctx: CliContext, sessionId: string): string => path.join(ctx.stateDir(), "sessions", `${safeSessionId(sessionId)}.json`);

/** A saved session state, or undefined when the text is not a valid one. Never throws. */
export function parseSessionState(text: string): SessionState | undefined {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Loads this session's state, or a fresh one when missing or damaged. */
export async function loadState(ctx: CliContext, sessionId: string): Promise<SessionState> {
  const text = await ctx.readText(stateFile(ctx, sessionId));
  return (text === undefined ? undefined : parseSessionState(text)) ?? freshState(ctx);
}

export interface SessionSummary {
  /** The session's file name without its extension. */
  id: string;
  startedAt: string;
  filesEdited: number;
  backups: number;
}

/**
 * The sessions JPE still has a record of, newest first. States are removed a week after they were last written, so this is
 * recent history only. Damaged files are skipped rather than shown as sessions that never happened.
 */
export async function listSessions(ctx: Pick<CliContext, "stateDir" | "readText">): Promise<SessionSummary[]> {
  const dir = path.join(ctx.stateDir(), "sessions");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: SessionSummary[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const text = await ctx.readText(path.join(dir, name)).catch(() => undefined);
    const state = text === undefined ? undefined : parseSessionState(text);
    if (state !== undefined) out.push({ id: name.slice(0, -".json".length), startedAt: state.startedAt, filesEdited: Object.keys(state.edits).length, backups: Object.keys(state.backups).length });
  }
  return out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

const trim = (record: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(record).slice(-MAX_ENTRIES));

export async function saveState(ctx: CliContext, sessionId: string, state: SessionState): Promise<void> {
  const bounded: SessionState = { ...state, edits: trim(state.edits), backups: trim(state.backups), checked: trim(state.checked) };
  await ctx.writeText(stateFile(ctx, sessionId), JSON.stringify(bounded));
}

/** Deletes session state files that have not been touched for a week. */
export async function pruneStaleStates(ctx: CliContext): Promise<void> {
  const dir = path.join(ctx.stateDir(), "sessions");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const cutoff = ctx.now().getTime() - STALE_MS;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    try {
      if ((await stat(file)).mtimeMs < cutoff) await unlink(file);
    } catch {
      // another process may have removed it; nothing to do
    }
  }
}

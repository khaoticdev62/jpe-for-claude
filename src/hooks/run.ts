import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { CliContext } from "../cli/context.js";
import { redactSecrets } from "../core/redact.js";
import { onPostToolUse, onPreToolUse, onSessionStart, onStop, onToolFailure, onUserPrompt } from "./handlers.js";
import { isHookEvent, parsePayload, type HookEvent, type HookOutput } from "./payload.js";

const MAX_STDIN_BYTES = 2 * 1024 * 1024;

export interface HookRunDeps {
  readStdin: () => Promise<string>;
  /** Builds the context for the project folder. */
  makeContext: (cwd: string) => CliContext;
  write: (text: string) => void;
  /** Hard stop for the whole hook, kept below the timeout configured in hooks.json. */
  deadlineMs: number;
  debug: boolean;
}

type Dispatch = { [E in HookEvent]: (payload: never, ctx: CliContext) => Promise<HookOutput | undefined> };

const HANDLERS: Dispatch = {
  SessionStart: onSessionStart as Dispatch["SessionStart"],
  UserPromptSubmit: onUserPrompt as Dispatch["UserPromptSubmit"],
  PreToolUse: onPreToolUse as Dispatch["PreToolUse"],
  PostToolUse: onPostToolUse as Dispatch["PostToolUse"],
  PostToolUseFailure: onToolFailure as Dispatch["PostToolUseFailure"],
  Stop: onStop as Dispatch["Stop"],
};

async function debugLog(ctx: CliContext | undefined, line: string): Promise<void> {
  if (!ctx) return;
  try {
    const file = path.join(ctx.stateDir(), "hook-debug.log");
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${new Date().toISOString()} ${redactSecrets(line)}\n`);
  } catch {
    // diagnostics must never break a hook
  }
}

/**
 * Runs one hook invocation. It always resolves and never throws: malformed input, internal errors
 * and timeouts all end with no output, so Claude Code carries on exactly as if JPE were absent.
 */
export async function runHook(eventName: string, deps: HookRunDeps): Promise<void> {
  if (!isHookEvent(eventName)) return;
  let ctx: CliContext | undefined;
  try {
    const raw = await deps.readStdin();
    if (raw.length > MAX_STDIN_BYTES) return;
    const payload = parsePayload(eventName, raw);
    ctx = deps.makeContext(process.env["CLAUDE_PROJECT_DIR"] || payload.cwd);
    const handler = HANDLERS[eventName] as (p: unknown, c: CliContext) => Promise<HookOutput | undefined>;

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), deps.deadlineMs);
    });
    const result = await Promise.race([handler(payload, ctx), deadline]);
    if (timer) clearTimeout(timer);

    if (result === "timeout") {
      if (deps.debug) await debugLog(ctx, `${eventName} timed out after ${deps.deadlineMs}ms`);
      return;
    }
    if (result) deps.write(JSON.stringify(result));
    if (deps.debug) await debugLog(ctx, `${eventName} ok${result ? ` output=${JSON.stringify(result).slice(0, 200)}` : " (no output)"}`);
  } catch (error) {
    if (deps.debug) await debugLog(ctx, `${eventName} failed open: ${error instanceof Error ? error.message : String(error)}`);
  }
}

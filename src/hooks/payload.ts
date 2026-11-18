import { createHash } from "node:crypto";
import { z } from "zod";
import { JpeError } from "../core/errors.js";

const base = {
  session_id: z.string().min(1).max(200),
  cwd: z.string().min(1),
  hook_event_name: z.string(),
  transcript_path: z.string().optional(),
};

const toolInput = z.record(z.string(), z.unknown());

/** Payloads as documented for each event. Loose objects: new fields from Claude Code are ignored, not rejected. */
export const payloadSchemas = {
  SessionStart: z.looseObject({ ...base, source: z.string().optional() }),
  UserPromptSubmit: z.looseObject({ ...base, prompt: z.string() }),
  PreToolUse: z.looseObject({ ...base, tool_name: z.string(), tool_input: toolInput }),
  PostToolUse: z.looseObject({ ...base, tool_name: z.string(), tool_input: toolInput, tool_response: z.unknown().optional() }),
  PostToolUseFailure: z.looseObject({ ...base, tool_name: z.string(), tool_input: toolInput, error: z.string().optional(), is_interrupt: z.boolean().optional() }),
  Stop: z.looseObject({ ...base, stop_hook_active: z.boolean().optional(), last_assistant_message: z.string().optional() }),
  SubagentStart: z.looseObject({ ...base, agent_id: z.string().min(1).max(200), agent_type: z.string().max(200) }),
  SubagentStop: z.looseObject({ ...base, agent_id: z.string().min(1).max(200), agent_type: z.string().max(200), last_assistant_message: z.string().optional() }),
} as const;

export type HookEvent = keyof typeof payloadSchemas;
export const HOOK_EVENTS = Object.keys(payloadSchemas) as HookEvent[];

export type PayloadOf<E extends HookEvent> = z.infer<(typeof payloadSchemas)[E]>;

export function isHookEvent(name: string): name is HookEvent {
  return (HOOK_EVENTS as string[]).includes(name);
}

/** Parses and validates stdin JSON for one event; malformed input becomes a JpeError (the caller fails open). */
export function parsePayload<E extends HookEvent>(event: E, raw: string): PayloadOf<E> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new JpeError("INVALID_INPUT", "The hook input was not valid JSON.", { cause });
  }
  const parsed = payloadSchemas[event].safeParse(json);
  if (!parsed.success) throw new JpeError("INVALID_INPUT", `The ${event} hook input did not have the expected shape.`);
  const actual = (parsed.data as { hook_event_name: string }).hook_event_name;
  if (actual !== event) throw new JpeError("INVALID_INPUT", `Expected a ${event} payload but received ${actual}.`);
  return parsed.data as PayloadOf<E>;
}

/** A file-name-safe form of the session id. */
export function safeSessionId(id: string): string {
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : createHash("sha256").update(id).digest("hex").slice(0, 32);
}

/** Hook JSON output shapes (hookSpecificOutput form). */
export interface HookOutput {
  decision?: "block";
  reason?: string;
  /** A short notice shown to the user (not added to Claude's context). */
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
    permissionDecision?: "ask";
    permissionDecisionReason?: string;
  };
}

export const context = (event: HookEvent, text: string): HookOutput => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

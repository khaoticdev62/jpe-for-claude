/**
 * The record of real agent activity: one line each time Claude Code reports that a subagent started or stopped.
 *
 * Nothing here is inferred. A line exists only because Claude Code raised the event. The record holds ids, the agent's
 * type, times and the length of the final message, and deliberately never the task prompt or the agent's words, which
 * can contain private material. Lines are appended (parallel agents report at nearly the same moment, and an append
 * cannot lose a neighbour's line the way read-and-rewrite can) and the file is trimmed later, when a session starts.
 */

export const AGENT_EVENT_KINDS = ["start", "stop"] as const;
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

export const MAX_AGENT_EVENTS = 1000;
const MAX_FIELD = 200;

export interface AgentEvent {
  /** ISO time JPE received the event. */
  at: string;
  kind: AgentEventKind;
  agentId: string;
  agentType: string;
  sessionId: string;
  /** Stop events only: how many characters the agent's final message had. The message itself is never stored. */
  finalMessageChars?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_FIELD;

/** One stored line back into an event, or undefined if it is not a valid record. Never throws. */
export function parseAgentEvent(line: string): AgentEvent | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;
  const { at, kind, agentId, agentType, sessionId, finalMessageChars } = raw;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return undefined;
  if (!(AGENT_EVENT_KINDS as readonly unknown[]).includes(kind)) return undefined;
  if (!isText(agentId) || !isText(agentType) || !isText(sessionId)) return undefined;
  if (finalMessageChars !== undefined && !(typeof finalMessageChars === "number" && Number.isInteger(finalMessageChars) && finalMessageChars >= 0)) return undefined;
  return { at, kind: kind as AgentEventKind, agentId, agentType, sessionId, ...(finalMessageChars === undefined ? {} : { finalMessageChars }) };
}

/** Every valid event in a stored file, in the order recorded. Damaged lines are skipped. */
export function parseAgentEvents(text: string): AgentEvent[] {
  return text.split(/\r?\n/).flatMap((line) => (line.trim() === "" ? [] : [parseAgentEvent(line) ?? []].flat()));
}

/** The line to append for an event. */
export const serializeAgentEvent = (event: AgentEvent): string => `${JSON.stringify(event)}\n`;

/** The stored text trimmed to the most recent events, with damaged lines dropped. */
export function trimAgentEvents(text: string): string {
  const events = parseAgentEvents(text).slice(-MAX_AGENT_EVENTS);
  return events.length === 0 ? "" : `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

/** Builds an event from what Claude Code reported, cutting every field to a safe length. */
export function makeAgentEvent(input: { at: Date; kind: AgentEventKind; agentId: string; agentType: string; sessionId: string; finalMessageChars?: number }): AgentEvent {
  const cut = (v: string): string => v.slice(0, MAX_FIELD);
  return {
    at: input.at.toISOString(),
    kind: input.kind,
    agentId: cut(input.agentId),
    agentType: cut(input.agentType) || "unknown",
    sessionId: cut(input.sessionId),
    ...(input.finalMessageChars === undefined ? {} : { finalMessageChars: input.finalMessageChars }),
  };
}

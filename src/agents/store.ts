import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { CliContext } from "../cli/context.js";
import { type AgentEvent, parseAgentEvents, serializeAgentEvent, trimAgentEvents } from "./log.js";

export const AGENT_EVENTS_FILE = "agents.jsonl";

const fileFor = (ctx: Pick<CliContext, "stateDir">): string => path.join(ctx.stateDir(), AGENT_EVENTS_FILE);

/** Appends one event. An append cannot lose another process's line, which matters when agents report together. */
export async function recordAgentEvent(ctx: Pick<CliContext, "stateDir">, event: AgentEvent): Promise<void> {
  const file = fileFor(ctx);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, serializeAgentEvent(event), "utf8");
}

/** Every recorded agent event for this project, oldest first. A missing or damaged file reads as no events. */
export async function loadAgentEvents(ctx: Pick<CliContext, "stateDir" | "readText">): Promise<AgentEvent[]> {
  const text = await ctx.readText(fileFor(ctx)).catch(() => undefined);
  return text === undefined ? [] : parseAgentEvents(text);
}

/** Trims the record to the most recent events. Run when a session starts, when no agent is likely to be reporting. */
export async function pruneAgentEvents(ctx: Pick<CliContext, "stateDir" | "readText" | "writeText">): Promise<void> {
  const text = await ctx.readText(fileFor(ctx)).catch(() => undefined);
  if (text === undefined || text.split("\n").length <= 1100) return;
  await ctx.writeText(fileFor(ctx), trimAgentEvents(text));
}

/**
 * Turns the event record into runs and numbers, without guessing.
 *
 * A run is "running" only while its start has been seen, no stop has been seen, and it is recent. Past a time limit a
 * run with no stop event is reported as "no stop seen" (it may have been interrupted, or the stop event may not have
 * arrived), never as finished or failed: JPE does not know, and says so. Durations exist only for runs whose start and
 * stop were both seen. Claude Code does not report whether a subagent succeeded, so JPE does not report success rates.
 */

import type { AgentEvent } from "./log.js";

/** A run with no stop event after this long is no longer called "running". */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export type RunState = "running" | "finished" | "no-stop-seen";

export interface AgentRun {
  agentId: string;
  agentType: string;
  sessionId: string;
  startedAt?: string;
  stoppedAt?: string;
  /** Milliseconds between the start and stop events, only when both were seen and the times are in order. */
  durationMs?: number;
  state: RunState;
  finalMessageChars?: number;
}

/** Groups events by agent id into runs, newest first. A stop with no start (the record was trimmed) is still a run. */
export function buildRuns(events: readonly AgentEvent[], now: Date): AgentRun[] {
  const byId = new Map<string, { start?: AgentEvent; stop?: AgentEvent; type: string; session: string }>();
  for (const e of events) {
    const entry = byId.get(e.agentId) ?? { type: e.agentType, session: e.sessionId };
    if (e.kind === "start") entry.start = e;
    else entry.stop = e;
    entry.type = e.agentType;
    byId.set(e.agentId, entry);
  }
  const runs: AgentRun[] = [...byId].map(([agentId, { start, stop, type, session }]): AgentRun => {
    const startedMs = start === undefined ? undefined : Date.parse(start.at);
    const stoppedMs = stop === undefined ? undefined : Date.parse(stop.at);
    const duration = startedMs !== undefined && stoppedMs !== undefined && stoppedMs >= startedMs ? stoppedMs - startedMs : undefined;
    const state: RunState = stop !== undefined ? "finished" : startedMs !== undefined && now.getTime() - startedMs <= STALE_AFTER_MS ? "running" : "no-stop-seen";
    return {
      agentId,
      agentType: type,
      sessionId: session,
      ...(start === undefined ? {} : { startedAt: start.at }),
      ...(stop === undefined ? {} : { stoppedAt: stop.at }),
      ...(duration === undefined ? {} : { durationMs: duration }),
      state,
      ...(stop?.finalMessageChars === undefined ? {} : { finalMessageChars: stop.finalMessageChars }),
    };
  });
  const when = (r: AgentRun): number => Date.parse(r.startedAt ?? r.stoppedAt ?? "") || 0;
  return runs.sort((a, b) => when(b) - when(a));
}

export interface AgentSummary {
  running: number;
  total: number;
  /** Runs that never reported a stop and are old enough that they are no longer called running. */
  noStopSeen: number;
}

export const summarize = (runs: readonly AgentRun[]): AgentSummary => ({
  running: runs.filter((r) => r.state === "running").length,
  total: runs.length,
  noStopSeen: runs.filter((r) => r.state === "no-stop-seen").length,
});

/** One honest sentence about agents, for the command center and the agents screen. */
export function agentsSentence(summary: AgentSummary): string {
  if (summary.total === 0) return "No agent activity has been recorded in this project.";
  const parts = [`${summary.running} running`, `${summary.total} recorded`];
  if (summary.noStopSeen > 0) parts.push(`${summary.noStopSeen} with no stop seen`);
  return parts.join(", ");
}

export interface AgentMetrics {
  agentType: string;
  runs: number;
  running: number;
  finished: number;
  noStopSeen: number;
  /** Over the finished runs that have a duration; undefined when there are none. */
  medianMs?: number;
  maxMs?: number;
  totalMs: number;
  lastStartedAt?: string;
}

const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
};

/** Per agent type: how many runs, in which state, and how long the finished ones took. Most-used first. */
export function buildMetrics(runs: readonly AgentRun[]): AgentMetrics[] {
  const types = new Map<string, AgentRun[]>();
  for (const r of runs) types.set(r.agentType, [...(types.get(r.agentType) ?? []), r]);
  return [...types]
    .map(([agentType, list]): AgentMetrics => {
      const durations = list.flatMap((r) => (r.durationMs === undefined ? [] : [r.durationMs]));
      const med = median(durations);
      const last = list.map((r) => r.startedAt).filter((s): s is string => s !== undefined).sort().at(-1);
      return {
        agentType,
        runs: list.length,
        running: list.filter((r) => r.state === "running").length,
        finished: list.filter((r) => r.state === "finished").length,
        noStopSeen: list.filter((r) => r.state === "no-stop-seen").length,
        ...(med === undefined ? {} : { medianMs: med }),
        ...(durations.length === 0 ? {} : { maxMs: Math.max(...durations) }),
        totalMs: durations.reduce((a, b) => a + b, 0),
        ...(last === undefined ? {} : { lastStartedAt: last }),
      };
    })
    .sort((a, b) => b.runs - a.runs || a.agentType.localeCompare(b.agentType));
}

/** "850 ms", "12 s", "3 min 05 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

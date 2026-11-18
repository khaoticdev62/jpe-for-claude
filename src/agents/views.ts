/**
 * Screens for the agent control center. Pure: they draw what the recorded events say and nothing else.
 *
 * What Claude Code reports is: an agent started, an agent stopped, its type, and the length of its final message. So the
 * screens show running or finished, how long finished runs took, and how often each type was used. They do not show
 * success or failure, progress, cost, tokens or the agent's task: none of that is reported, and JPE does not guess it.
 */

import { formatAge } from "../center/home.js";
import { blank, bulletList, heading, statusBadge, table, textLines } from "../ui/components.js";
import type { Line } from "../ui/doc.js";
import type { RenderProfile } from "../ui/profile.js";
import { inline } from "../ui/text.js";
import { agentsSentence, type AgentMetrics, type AgentRun, formatDuration, type RunState, summarize } from "./runs.js";

export const SHOWN_RUNS = 15;
const ID_CHARS = 8;

const STATE_WORD: Record<RunState, string> = { running: "running", finished: "finished", "no-stop-seen": "no stop seen" };

const shortId = (id: string): string => inline(id).slice(0, ID_CHARS);

export function agentsView(runs: readonly AgentRun[], metrics: readonly AgentMetrics[], now: Date, profile: RenderProfile): Line[] {
  const out: Line[] = [...heading("Agent activity", profile)];
  const summary = summarize(runs);
  out.push(...statusBadge(summary.running > 0 ? "info" : "inactive", agentsSentence(summary), profile));
  if (runs.length === 0) {
    out.push(blank(), ...textLines("Nothing is recorded yet. When Claude Code starts or stops a subagent in this project, JPE records the event here; it never invents activity.", profile.width));
    return out;
  }
  out.push(
    blank(),
    ...table(
      {
        columns: [{ header: "Agent", min: 8 }, { header: "State", min: 8 }, { header: "Started", min: 8 }, { header: "Took", align: "right", min: 6 }, { header: "Id", min: 4 }],
        rows: runs.slice(0, SHOWN_RUNS).map((r) => [inline(r.agentType), STATE_WORD[r.state], r.startedAt === undefined ? "unknown" : formatAge(r.startedAt, now), r.durationMs === undefined ? "-" : formatDuration(r.durationMs), shortId(r.agentId)]),
      },
      profile,
    ),
  );
  if (runs.length > SHOWN_RUNS) out.push(...textLines(`${runs.length - SHOWN_RUNS} older runs are not shown.`, profile.width, { role: "muted" }));
  out.push(blank(), ...heading("By agent type", profile));
  out.push(
    ...table(
      {
        columns: [{ header: "Agent", min: 8 }, { header: "Runs", align: "right", min: 4 }, { header: "Running", align: "right", min: 7 }, { header: "Finished", align: "right", min: 8 }, { header: "Typical", align: "right", min: 7 }, { header: "Longest", align: "right", min: 7 }],
        rows: metrics.map((m) => [inline(m.agentType), String(m.runs), String(m.running), String(m.finished), m.medianMs === undefined ? "-" : formatDuration(m.medianMs), m.maxMs === undefined ? "-" : formatDuration(m.maxMs)]),
      },
      profile,
    ),
  );
  out.push(
    blank(),
    ...bulletList(
      [
        "These are the start and stop events Claude Code reported. They do not say whether an agent's work was right, or whether it succeeded.",
        "A run with no stop event after 30 minutes is shown as \"no stop seen\": it may have been interrupted, or the event may not have arrived. JPE does not call it failed.",
        "Times are measured between the two events; \"Typical\" is the median of finished runs.",
      ],
      profile,
    ),
  );
  return out;
}

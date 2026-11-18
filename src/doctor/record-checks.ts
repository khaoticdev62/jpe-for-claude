import path from "node:path";
import { parseAgentEvents } from "../agents/log.js";
import { AGENT_EVENTS_FILE } from "../agents/store.js";
import { parseDecisions } from "../review/decisions.js";
import { DECISIONS_FILE } from "../review/status.js";
import { readLastStatus } from "../verification/last-status.js";
import type { DoctorEnv, Finding } from "./types.js";

const f = (id: string, status: Finding["status"], title: string, extra: Partial<Finding> = {}): Finding => ({ id, area: "Records", status, title, ...extra });

const nonBlankLines = (text: string): number => text.split(/\r?\n/).filter((l) => l.trim() !== "").length;

interface LineRecord {
  id: string;
  file: string;
  label: string;
  /** How many records of the file can be read. */
  readable: (text: string) => number;
}

const LINE_RECORDS: readonly LineRecord[] = [
  { id: "agents-record", file: AGENT_EVENTS_FILE, label: "agent activity", readable: (t) => parseAgentEvents(t).length },
  { id: "review-record", file: DECISIONS_FILE, label: "review decisions", readable: (t) => parseDecisions(t).length },
];

/**
 * Whether JPE's own saved records for this project can be read. A damaged line is skipped when the record is read, so
 * nothing breaks, but it means something wrote a bad line, and the Doctor says so instead of leaving it unnoticed.
 * Records that do not exist yet are not a problem and produce no finding.
 */
export async function checkRecords(env: DoctorEnv): Promise<Finding[]> {
  const { ctx } = env;
  const out: Finding[] = [];
  for (const rec of LINE_RECORDS) {
    const text = await ctx.fs.readText(path.join(ctx.stateDir(), rec.file));
    if (text === undefined) continue;
    const lines = nonBlankLines(text);
    const readable = rec.readable(text);
    out.push(
      readable === lines
        ? f(rec.id, "ok", `The ${rec.label} record is readable (${lines} ${lines === 1 ? "entry" : "entries"}).`)
        : f(rec.id, "warn", `${lines - readable} of ${lines} entries in the ${rec.label} record cannot be read and are skipped.`, { detail: path.join(ctx.stateDir(), rec.file), fix: "They are ignored, so nothing is broken. If it keeps happening, report it; deleting that file starts the record again." }),
    );
  }
  try {
    const last = await readLastStatus(ctx);
    if (last !== undefined) out.push(f("verification-record", "ok", `The saved verification record is readable (${last.report.status}).`));
  } catch {
    out.push(f("verification-record", "warn", "The saved verification record is damaged and is reported as not tested.", { fix: "Run /jpe:verify again to replace it." }));
  }
  return out;
}

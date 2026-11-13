import { createHash } from "node:crypto";
import type { DiscoveredCheck } from "../project/checks.js";
import { isFailure, runChecks, type Baseline, type CheckOutcome, type RunnerDeps } from "./runner.js";

export type RepairOutcome =
  /** Nothing was failing, so no repair was needed. */
  | "passed"
  /** Failures were repaired and a full re-run (the regression check) is clean. */
  | "fixed"
  /** The attempt limit was reached with failures remaining. */
  | "exhausted"
  /** The same failure came back after a change; further attempts would loop. */
  | "stalled"
  /** The repairer made no change, so there is nothing new to test. */
  | "no-fix"
  /** The overall time budget ran out. */
  | "deadline";

export interface RepairRequest {
  attempt: number;
  failures: CheckOutcome[];
}

export interface RepairResult {
  /** Whether files were actually changed. */
  changed: boolean;
  summary: string;
}

export interface RepairStep {
  attempt: number;
  failing: string[];
  summary: string;
}

export interface RepairLoopOptions {
  checks: readonly DiscoveredCheck[];
  deps: RunnerDeps;
  baseline?: Baseline;
  /** From config engineering.maxRepairAttempts. */
  maxAttempts: number;
  /** Total time budget for the whole loop. */
  deadlineMs: number;
  now: () => number;
  /** Makes one targeted correction. The caller (Claude, with the user's permissions) does the editing. */
  repair: (request: RepairRequest) => Promise<RepairResult>;
}

export interface RepairLoopResult {
  outcome: RepairOutcome;
  attempts: number;
  history: RepairStep[];
  /** Latest outcome of every check after the loop ended. */
  outcomes: CheckOutcome[];
}

/** Identity of a failure set: command, exit code, and the tail of the output with numbers removed. */
function signature(failures: readonly CheckOutcome[]): string {
  return failures
    .map((f) => {
      const tail = f.output.slice(-400).replace(/\d+/g, "#").replace(/\s+/g, " ");
      return `${f.display}|${f.exitCode ?? "x"}|${createHash("sha256").update(tail).digest("hex").slice(0, 16)}`;
    })
    .sort()
    .join("\n");
}

function mergeOutcomes(previous: readonly CheckOutcome[], updated: readonly CheckOutcome[]): CheckOutcome[] {
  const byDisplay = new Map(updated.map((o) => [o.display, o] as const));
  return previous.map((o) => byDisplay.get(o.display) ?? o);
}

/**
 * Bounded repair loop: run, repair, re-run the failing checks, then re-run everything to catch
 * regressions. It always terminates (attempt limit, deadline, stall detection) and never repairs
 * failures that already existed before the change.
 */
export async function repairLoop(options: RepairLoopOptions): Promise<RepairLoopResult> {
  const { checks, deps, baseline, maxAttempts, deadlineMs, now, repair } = options;
  const startedAt = now();
  const history: RepairStep[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  let outcomes = await runChecks(checks, deps, baseline);

  for (;;) {
    const failures = outcomes.filter(isFailure);
    const done = (outcome: RepairOutcome): RepairLoopResult => ({ outcome, attempts, history, outcomes });
    if (failures.length === 0) return done(attempts === 0 ? "passed" : "fixed");
    if (attempts >= maxAttempts) return done("exhausted");
    if (now() - startedAt >= deadlineMs) return done("deadline");
    const sig = signature(failures);
    if (seen.has(sig)) return done("stalled");
    seen.add(sig);

    attempts++;
    const result = await repair({ attempt: attempts, failures });
    history.push({ attempt: attempts, failing: failures.map((f) => f.display), summary: result.summary });
    if (!result.changed) return done("no-fix");

    const failingChecks = checks.filter((c) => failures.some((f) => f.display === c.display));
    const rerun = await runChecks(failingChecks, deps, baseline);
    outcomes = mergeOutcomes(outcomes, rerun);
    if (!rerun.some(isFailure)) outcomes = await runChecks(checks, deps, baseline); // full regression pass
  }
}

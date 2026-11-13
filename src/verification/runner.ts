import { isJpeError } from "../core/errors.js";
import type { CheckName } from "../core/evidence.js";
import type { EvidenceLedger } from "../core/ledger.js";
import type { DiscoveredCheck } from "../project/checks.js";
import type { RunOptions, RunResult } from "../security/run.js";

export interface RunnerDeps {
  run: (options: RunOptions) => Promise<RunResult>;
  ledger: EvidenceLedger;
  cwd: string;
  timeoutMs: number;
}

export type OutcomeState = "passed" | "failed" | "timed-out" | "unavailable";

export interface CheckOutcome {
  check: CheckName;
  /** The exact command line, used as the stable identity of this check. */
  display: string;
  state: OutcomeState;
  exitCode?: number;
  /** True when this check was already failing before the change (see captureBaseline). */
  preexisting: boolean;
  output: string;
}

/** Maps a check's command line to whether it passed before any change was made. */
export type Baseline = ReadonlyMap<string, "pass" | "fail">;

function combinedOutput(result: RunResult): string {
  return [result.stdout, result.stderr].filter((s) => s !== "").join("\n");
}

function countWarnings(output: string): number {
  const match = /(\d+)\s+warnings?\b/i.exec(output);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

export function isFailure(outcome: CheckOutcome): boolean {
  return (outcome.state === "failed" || outcome.state === "timed-out") && !outcome.preexisting;
}

async function runOne(
  check: DiscoveredCheck,
  deps: Pick<RunnerDeps, "run" | "cwd" | "timeoutMs">,
): Promise<{ result: RunResult } | { unavailable: string }> {
  try {
    return { result: await deps.run({ file: check.file, args: check.args, cwd: deps.cwd, timeoutMs: deps.timeoutMs }) };
  } catch (error) {
    if (isJpeError(error)) return { unavailable: error.userMessage };
    throw error;
  }
}

/**
 * Runs checks one at a time and records exactly what happened in the ledger.
 * A tool that is missing is recorded as "not run", never as a pass.
 */
export async function runChecks(checks: readonly DiscoveredCheck[], deps: RunnerDeps, baseline?: Baseline): Promise<CheckOutcome[]> {
  const outcomes: CheckOutcome[] = [];
  for (const check of checks) {
    const ran = await runOne(check, deps);
    if ("unavailable" in ran) {
      deps.ledger.recordNotRun(check.check, ran.unavailable);
      outcomes.push({ check: check.check, display: check.display, state: "unavailable", preexisting: false, output: ran.unavailable });
      continue;
    }
    const { result } = ran;
    const failed = result.exitCode !== 0 || result.timedOut;
    const preexisting = failed && baseline?.get(check.display) === "fail";
    const output = combinedOutput(result);
    deps.ledger.recordCommand({
      check: check.check,
      command: check.display,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      preexisting,
      warnings: countWarnings(output),
      output,
    });
    outcomes.push({
      check: check.check,
      display: check.display,
      state: result.timedOut ? "timed-out" : failed ? "failed" : "passed",
      exitCode: result.exitCode,
      preexisting,
      output,
    });
  }
  return outcomes;
}

/**
 * Runs checks BEFORE any change so failures that already existed can be told apart from new ones.
 * Nothing is written to the ledger, because these results describe the old code, not the change.
 */
export async function captureBaseline(checks: readonly DiscoveredCheck[], deps: Pick<RunnerDeps, "run" | "cwd" | "timeoutMs">): Promise<Baseline> {
  const baseline = new Map<string, "pass" | "fail">();
  for (const check of checks) {
    const ran = await runOne(check, deps);
    if ("unavailable" in ran) continue;
    baseline.set(check.display, ran.result.exitCode === 0 && !ran.result.timedOut ? "pass" : "fail");
  }
  return baseline;
}

/** Checks that passed before the change but fail now: the definition of a regression. */
export function findRegressions(baseline: Baseline, outcomes: readonly CheckOutcome[]): CheckOutcome[] {
  return outcomes.filter((o) => isFailure(o) && baseline.get(o.display) === "pass");
}

import { createHash } from "node:crypto";
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
  /** True when this check was already failing before the change, in the same way (see captureBaseline). */
  preexisting: boolean;
  /** True when the check failed before the change too, but now fails differently: treated as a new failure. */
  changedFailure: boolean;
  output: string;
}

export interface BaselineEntry {
  result: "pass" | "fail";
  /** Fingerprint of the failure output, so "still failing the same way" can be told from "now failing differently". */
  signature: string;
}

/** Maps a check's command line to how it behaved before any change was made. */
export type Baseline = ReadonlyMap<string, BaselineEntry>;

const MAX_SIGNATURE_INPUT = 64 * 1024;

/**
 * Fingerprint of a failure: the output with numbers (timings, counts, line numbers), colour codes and
 * whitespace removed. One command (say `npm test`) can fail for an old reason and a new one at once; comparing
 * fingerprints stops a new failure from hiding behind an old one.
 */
export function failureSignature(output: string): string {
  // Normalise first, then bound the size: slicing raw text first would let a number that gains a digit
  // shift the window and make an identical failure look different.
  const normalized = output
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-MAX_SIGNATURE_INPUT);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

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
      outcomes.push({ check: check.check, display: check.display, state: "unavailable", preexisting: false, changedFailure: false, output: ran.unavailable });
      continue;
    }
    const { result } = ran;
    const failed = result.exitCode !== 0 || result.timedOut;
    const output = combinedOutput(result);
    const before = baseline?.get(check.display);
    const failedBefore = failed && before?.result === "fail";
    const preexisting = failedBefore && before?.signature === failureSignature(output);
    const changedFailure = failedBefore && !preexisting;
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
      changedFailure,
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
  const baseline = new Map<string, BaselineEntry>();
  for (const check of checks) {
    const ran = await runOne(check, deps);
    if ("unavailable" in ran) continue;
    const passed = ran.result.exitCode === 0 && !ran.result.timedOut;
    baseline.set(check.display, { result: passed ? "pass" : "fail", signature: passed ? "" : failureSignature(combinedOutput(ran.result)) });
  }
  return baseline;
}

/** Checks that passed before the change but fail now, or that now fail in a new way: the definition of a regression. */
export function findRegressions(baseline: Baseline, outcomes: readonly CheckOutcome[]): CheckOutcome[] {
  return outcomes.filter((o) => isFailure(o) && (baseline.get(o.display)?.result === "pass" || o.changedFailure));
}

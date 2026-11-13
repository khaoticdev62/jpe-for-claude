import type { CheckName, CommandEvidence, Evidence } from "./evidence.js";

export const COMPLETION_STATUSES = [
  "VERIFIED",
  "FUNCTIONAL_WITH_WARNINGS",
  "PARTIALLY_VERIFIED",
  "FAILED",
  "BLOCKED",
  "NOT_TESTED",
] as const;

export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

export type CheckState = "passed" | "failed" | "failed-preexisting" | "not-run";

export interface StatusReport {
  status: CompletionStatus;
  /** Plain-English reasons, one per finding, so the status is never a bare label. */
  reasons: string[];
  checks: Record<string, CheckState>;
}

function passed(e: CommandEvidence): boolean {
  return e.exitCode === 0 && !e.timedOut;
}

/**
 * Derives the completion status from recorded evidence only.
 * `required` lists the checks that apply to this project/change. The most recent run of each
 * check wins, so a passing re-run after a repair supersedes the earlier failure.
 *
 * Precedence: BLOCKED > FAILED > NOT_TESTED > PARTIALLY_VERIFIED > FUNCTIONAL_WITH_WARNINGS > VERIFIED.
 */
export function deriveStatus(entries: readonly Evidence[], required: readonly CheckName[]): StatusReport {
  const reasons: string[] = [];
  const checks: Record<string, CheckState> = {};

  const blockers = entries.filter((e) => e.kind === "blocker");
  if (blockers.length > 0) {
    for (const b of blockers) reasons.push(`Blocked: ${b.reason}`);
    return { status: "BLOCKED", reasons, checks };
  }

  const latest = new Map<CheckName, CommandEvidence>();
  for (const e of entries) if (e.kind === "command") latest.set(e.check, e);

  const warnings: string[] = [];
  const failures: string[] = [];
  const missing: string[] = [];

  for (const check of required) {
    const run = latest.get(check);
    if (!run) {
      checks[check] = "not-run";
      const skipped = entries.find((e) => e.kind === "not-run" && e.check === check);
      missing.push(skipped?.kind === "not-run" ? `${check} was not run (${skipped.reason}).` : `${check} was not run.`);
      continue;
    }
    if (passed(run)) {
      checks[check] = "passed";
      if (run.warnings > 0) warnings.push(`${check} passed with ${run.warnings} warning(s).`);
    } else if (run.preexisting) {
      checks[check] = "failed-preexisting";
      warnings.push(`${check} fails, but the failure existed before this change.`);
    } else {
      checks[check] = "failed";
      failures.push(run.timedOut ? `${check} timed out.` : `${check} failed with exit code ${run.exitCode}.`);
    }
  }

  for (const e of entries) {
    if (e.kind !== "lsp") continue;
    if (!e.available) warnings.push(`Language server "${e.server}" was unavailable, so LSP diagnostics did not verify this change.`);
    else if (e.errors > 0) failures.push(`Language server "${e.server}" reports ${e.errors} error(s).`);
    else if (e.warnings > 0) warnings.push(`Language server "${e.server}" reports ${e.warnings} warning(s).`);
  }

  if (failures.length > 0) return { status: "FAILED", reasons: [...failures, ...missing, ...warnings], checks };

  const ranAnything = entries.some((e) => e.kind === "command" || (e.kind === "lsp" && e.available));
  if (required.length === 0 || !ranAnything) {
    reasons.push(required.length === 0 ? "No applicable checks were identified for this project." : "No checks were run.");
    return { status: "NOT_TESTED", reasons: [...reasons, ...missing, ...warnings], checks };
  }

  if (missing.length > 0) return { status: "PARTIALLY_VERIFIED", reasons: [...missing, ...warnings], checks };
  if (warnings.length > 0) return { status: "FUNCTIONAL_WITH_WARNINGS", reasons: warnings, checks };
  return { status: "VERIFIED", reasons: ["Every required check passed on its most recent run."], checks };
}

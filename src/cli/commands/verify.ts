import path from "node:path";
import { z } from "zod";
import { checkNameSchema, type CheckName } from "../../core/evidence.js";
import { EvidenceLedger } from "../../core/ledger.js";
import { COMPLETION_STATUSES, deriveStatus, type CompletionStatus, type StatusReport } from "../../core/status.js";
import { discoverChecks, type DiscoveredCheck } from "../../project/checks.js";
import { detectProject } from "../../project/detect.js";
import { readGitState } from "../../project/git.js";
import { readLastStatus } from "../../verification/last-status.js";
import { captureBaseline, isFailure, runChecks, type Baseline, type CheckOutcome } from "../../verification/runner.js";
import { JpeError } from "../../core/errors.js";
import { redactSecrets } from "../../core/redact.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";

const baselineSchema = z.record(z.string(), z.strictObject({ result: z.enum(["pass", "fail"]), signature: z.string() }));

/** Exit codes: 0 verified/partial/warnings, 1 failed, 3 blocked, 4 nothing tested. (2 is reserved for crashes.) */
export function exitCodeFor(status: CompletionStatus): number {
  return status === "FAILED" ? 1 : status === "BLOCKED" ? 3 : status === "NOT_TESTED" ? 4 : 0;
}

function formatStatus(report: StatusReport, extra: string[] = []): string {
  return [
    `STATUS: ${report.status}`,
    ...report.reasons.map((r) => `  - ${r}`),
    ...(Object.keys(report.checks).length > 0 ? ["Checks:", ...Object.entries(report.checks).map(([k, v]) => `  ${k}: ${v}`)] : []),
    ...extra,
    "",
    `(${COMPLETION_STATUSES.join(" | ")}; derived only from recorded evidence)`,
  ].join("\n");
}

function failureDetail(outcomes: readonly CheckOutcome[]): string[] {
  return outcomes.filter(isFailure).flatMap((o) => [
    ...(o.changedFailure ? ["", `NOTE: ${o.display} was already failing before the change, but it now fails differently, so this is treated as a NEW failure.`] : []),
    "", `--- ${o.display} (${o.state}${o.exitCode !== undefined ? `, exit ${o.exitCode}` : ""}) ---`, redactSecrets(o.output.slice(-1500))]);
}

async function select(args: ParsedArgs, ctx: CliContext): Promise<{ checks: DiscoveredCheck[]; warnings: string[] }> {
  const project = await detectProject(ctx.cwd, ctx.fs);
  const all = await discoverChecks(project, ctx.fs);
  const only = flagString(args, "only");
  if (!only) return { checks: all, warnings: project.warnings };
  const wanted = only.split(",").map((s) => s.trim());
  const bad = wanted.filter((w) => !checkNameSchema.safeParse(w).success);
  if (bad.length > 0) throw new JpeError("INVALID_INPUT", `Unknown check name(s): ${bad.join(", ")}.`);
  return { checks: all.filter((c) => wanted.includes(c.check)), warnings: project.warnings };
}

/** `jpe checks`: what this project is and which verification commands it actually has. */
export async function checksCommand(_args: ParsedArgs, ctx: CliContext): Promise<number> {
  const project = await detectProject(ctx.cwd, ctx.fs);
  const checks = await discoverChecks(project, ctx.fs);
  const git = await readGitState(ctx.git);
  ctx.out(
    [
      `Project: ${ctx.cwd}`,
      `Languages/ecosystems: ${project.ecosystems.join(", ") || "none detected"}${project.packageManager ? ` (package manager: ${project.packageManager})` : ""}`,
      `Instruction files: ${project.instructionFiles.join(", ") || "none"}`,
      `Git: ${!git.available ? "git is not installed" : !git.isRepo ? "not a repository" : `branch ${git.branch}, ${git.dirty ? `${git.changedFiles.length} uncommitted file(s)${git.truncated ? "+" : ""}` : "clean"}`}`,
      "",
      checks.length === 0 ? "No verification commands were found. JPE will not invent tests; say so in the report." : "Verification commands found:",
      ...checks.map((c) => `  [${c.check}] ${c.display}  (${c.source})`),
      ...project.warnings.map((w) => `WARNING: ${w}`),
    ].join("\n"),
  );
  return 0;
}

/** `jpe verify [--baseline] [--only a,b]`: runs the project's real checks and reports an evidence-based status. */
export async function verifyCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const cfg = await ctx.loadConfig();
  const { checks, warnings } = await select(args, ctx);
  const dir = ctx.stateDir();
  const deps = { run: ctx.run, cwd: ctx.cwd, timeoutMs: cfg.engineering.commandTimeoutMs };

  if (flagBool(args, "baseline")) {
    const baseline = await captureBaseline(checks, deps);
    await ctx.writeText(path.join(dir, "baseline.json"), JSON.stringify(Object.fromEntries(baseline)));
    ctx.out(["Baseline saved (results before changes; not evidence for the change itself):", ...[...baseline].map(([cmd, r]) => `  ${r.result === "pass" ? "passing" : "FAILING"}: ${cmd}`)].join("\n"));
    return 0;
  }

  let baseline: Baseline | undefined;
  const saved = await ctx.readText(path.join(dir, "baseline.json"));
  if (saved) {
    const parsed = baselineSchema.safeParse(JSON.parse(saved));
    if (parsed.success) baseline = new Map(Object.entries(parsed.data));
  }

  const ledger = new EvidenceLedger({ now: ctx.now, newId: ctx.newId });
  const outcomes = await runChecks(checks, { ...deps, ledger }, baseline);
  const required = [...new Set(checks.map((c) => c.check))] as CheckName[];
  await ctx.writeText(path.join(dir, "ledger.jsonl"), `${ledger.toJsonLines()}\n`);
  await ctx.writeText(path.join(dir, "run.json"), JSON.stringify({ at: ctx.now().toISOString(), required }));

  const report = deriveStatus(ledger.entries, required);
  const extra = [
    ...warnings.map((w) => `WARNING: ${w}`),
    ...(baseline ? [] : ["NOTE: no baseline was captured before the change, so pre-existing failures cannot be told apart from new ones."]),
    ...failureDetail(outcomes),
  ];
  ctx.out(formatStatus(report, extra));
  return exitCodeFor(report.status);
}

/** `jpe status`: the status of the most recent `verify` run, re-derived from its saved evidence. */
export async function statusCommand(_args: ParsedArgs, ctx: CliContext): Promise<number> {
  const last = await readLastStatus(ctx);
  if (last === undefined) {
    ctx.out("STATUS: NOT_TESTED\n  - No verification has been run for this project yet. Run `jpe verify`.");
    return exitCodeFor("NOT_TESTED");
  }
  ctx.out(formatStatus(last.report, [`Last run: ${last.at}`]));
  return exitCodeFor(last.report.status);
}

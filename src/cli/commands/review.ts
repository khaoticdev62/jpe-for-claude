import { mkdir } from "node:fs/promises";
import path from "node:path";
import { JpeError } from "../../core/errors.js";
import { appendDecision, cleanNote, DECISIONS, type Decision, type ReviewDecision } from "../../review/decisions.js";
import { reviewFingerprint } from "../../review/changes.js";
import { currentReviewStatus, DECISIONS_FILE, loadDecisions } from "../../review/status.js";
import { formatAge } from "../../center/home.js";
import { blank, bulletList, heading, statusBadge, table, textLines } from "../../ui/components.js";
import type { Line } from "../../ui/doc.js";
import { paint } from "../../ui/paint.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { renderContext } from "./render-profile.js";

const HISTORY_SHOWN = 20;
const SHORT = 8;

const decisionsFile = (ctx: CliContext): string => path.join(ctx.stateDir(), DECISIONS_FILE);

async function record(ctx: CliContext, decision: Decision, note: string): Promise<ReviewDecision> {
  const { fingerprint, fileCount } = await reviewFingerprint(ctx);
  if (fileCount === 0) throw new JpeError("INVALID_INPUT", "There are no uncommitted changes to review, so there is nothing to approve or reject.");
  const entry: ReviewDecision = { id: ctx.newId(), at: ctx.now().toISOString(), decision, fingerprint, fileCount, ...(note === "" ? {} : { note }) };
  await mkdir(path.dirname(decisionsFile(ctx)), { recursive: true });
  await ctx.writeText(decisionsFile(ctx), appendDecision(await loadDecisions(ctx), entry));
  return entry;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * `jpe review approve|reject [--note text] | status | history [--json]`
 *
 * Records a reviewer's decision about the uncommitted changes, tied to exactly those changes: if any file changes later,
 * the decision shows as stale. It records only. It never commits, stages or modifies anything.
 */
export async function reviewCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const sub = args.positionals[0];
  const json = flagBool(args, "json");
  const { profile } = await renderContext(args, ctx);
  const show = (lines: readonly Line[]): void => ctx.out(paint(lines, profile));

  if (sub === "approve" || sub === "reject") {
    const decision: Decision = sub === "approve" ? "approved" : "rejected";
    const entry = await record(ctx, decision, cleanNote(flagString(args, "note") ?? ""));
    if (json) ctx.out(JSON.stringify(entry, null, 2));
    else
      show([
        ...statusBadge(decision === "approved" ? "success" : "error", `Recorded: ${decision} (${plural(entry.fileCount, "file", "files")})`, profile),
        ...textLines(`Review fingerprint ${entry.fingerprint.slice(0, SHORT)}. This only records your decision: nothing was committed, staged or changed. If any of these files change, the decision is shown as stale.`, profile.width),
      ]);
    return 0;
  }

  if (sub === "status") {
    const status = await currentReviewStatus(ctx);
    if (json) {
      ctx.out(JSON.stringify({ state: status.state.kind, fileCount: status.fileCount, ...(status.state.kind === "none" ? {} : { decision: status.state.decision }) }, null, 2));
      return 0;
    }
    const s = status.state;
    const when = s.kind === "none" ? "" : formatAge(s.decision.at, ctx.now());
    const badge =
      s.kind === "none"
        ? statusBadge("inactive", `No decision recorded for ${plural(status.fileCount, "uncommitted file", "uncommitted files")}`, profile)
        : s.kind === "current"
          ? statusBadge(s.decision.decision === "approved" ? "success" : "error", `${s.decision.decision === "approved" ? "Approved" : "Rejected"} ${when}, and the changes are unchanged since`, profile)
          : statusBadge("warning", `Stale: the last decision (${s.decision.decision} ${when}) is about changes that are no longer the current ones`, profile);
    show([
      ...badge,
      ...(s.kind === "none" || s.decision.note === undefined ? [] : textLines(`Note: ${s.decision.note}`, profile.width, { role: "muted" })),
      ...(s.kind === "stale" ? textLines("Files have changed since you decided. Run `jpe show review`, then decide again.", profile.width) : []),
    ]);
    return 0;
  }

  if (sub === "history") {
    const decisions = (await loadDecisions(ctx)).slice(-HISTORY_SHOWN).reverse();
    if (json) {
      ctx.out(JSON.stringify(decisions, null, 2));
      return 0;
    }
    if (decisions.length === 0) {
      show([...heading("Review decisions", profile), ...textLines("No review decisions have been recorded for this project.", profile.width)]);
      return 0;
    }
    show([
      ...heading("Review decisions (newest first)", profile),
      ...table({ columns: [{ header: "When", min: 10 }, { header: "Decision", min: 8 }, { header: "Files", align: "right", min: 3 }, { header: "Note", min: 10 }], rows: decisions.map((d) => [formatAge(d.at, ctx.now()), d.decision, String(d.fileCount), d.note ?? ""]) }, profile),
      blank(),
      ...bulletList(["A decision is tied to the exact files that were changed at the time. It does not say whether later changes are fine."], profile),
    ]);
    return 0;
  }

  throw new JpeError("INVALID_INPUT", `Usage: jpe review <${["approve", "reject", "status", "history"].join("|")}> [--note text] [--json]\n  decisions: ${DECISIONS.join(", ")}`);
}

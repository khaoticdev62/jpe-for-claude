/**
 * Views that explain code from what JPE can verify about it: a file shown beside its structure, a change shown as a
 * diff, and a review of every change in the working tree.
 *
 * These show facts the engines measured (symbols, metrics, pattern matches, diff hunks). They are not prose written by
 * a model: the plain-English explanation of why code does what it does stays with Claude (`/jpe:explain`), and these
 * views are what it can be grounded in. Everything labelled a risk is a pattern match and is worded "possible".
 */

import type { Analysis, CodeSymbol, RiskFinding } from "../explain/analyze.js";
import type { ChangeSummary } from "../explain/diff.js";
import { lookupTerm } from "../explain/glossary.js";
import { type Annotation, callout, codeBlock, section, sideBySide } from "../ui/code.js";
import { blank, bulletList, heading, keyValues, statusBadge, table, textLines } from "../ui/components.js";
import { type Line, fitLine, span } from "../ui/doc.js";
import { languageFor } from "../ui/highlight.js";
import type { RenderProfile } from "../ui/profile.js";
import { inline } from "../ui/text.js";
import type { ReviewDecisionState } from "./review-data.js";

const withWidth = (profile: RenderProfile, width: number): RenderProfile => ({ ...profile, width });

const SEVERITY_LEVEL: Readonly<Record<RiskFinding["severity"], Annotation["level"]>> = { high: "error", medium: "warning", low: "info" };

export interface FileViewOptions {
  /** Whether the structure sections start open. */
  expanded: boolean;
  /** How many lines of code to show before summarising the rest. */
  maxLines: number;
}

function symbolLine(s: CodeSymbol): Line {
  const params = s.params === undefined || s.params === "" ? "" : `(${s.params})`;
  return [span(`${s.kind} `, { role: "muted" }), span(`${s.name}${params}`, { role: "accent" }), span(`  line ${s.line}${s.exported ? ", exported" : ""}`, { role: "muted" })];
}

function structurePanel(analysis: Analysis, expanded: boolean, profile: RenderProfile): Line[] {
  const m = analysis.metrics;
  const concepts = analysis.concepts.map((term) => {
    const entry = lookupTerm(term);
    return entry === undefined ? term : `${entry.term}: ${entry.plain}`;
  });
  return [
    ...section({ title: `Symbols (${analysis.symbols.length})`, body: analysis.symbols.length === 0 ? [[span("none found", { role: "muted" })]] : analysis.symbols.slice(0, 40).map(symbolLine), expanded }, profile),
    ...section(
      {
        title: "Measures",
        body: keyValues(
          [
            ["Code lines", String(m.codeLines)],
            ["Comment lines", String(m.commentLines)],
            ["Functions", String(m.functions)],
            ["Branches", String(m.branches)],
            ["Deepest nesting", String(m.maxNesting)],
            ["Complexity score", String(m.score)],
          ],
          profile,
        ),
        expanded,
      },
      profile,
    ),
    ...(concepts.length === 0 ? [] : section({ title: `Concepts in this code (${concepts.length})`, body: bulletList(concepts.slice(0, 12), profile), expanded }, profile)),
    ...(analysis.imports.length === 0 ? [] : section({ title: `Imports (${analysis.imports.length})`, body: analysis.imports.slice(0, 30).map((i): Line => [span(inline(i))]), expanded }, profile)),
  ];
}

/** A file's code, annotated with the possible risks found on its lines, beside its structure. */
export function fileView(analysis: Analysis, content: string, profile: RenderProfile, options: FileViewOptions): Line[] {
  const annotations: Annotation[] = analysis.risks.map((r) => ({ line: r.line, level: SEVERITY_LEVEL[r.severity], text: `${r.severity} risk: ${r.message}` }));
  const risks = analysis.risks.length;
  return [
    ...heading(`${analysis.file} (${analysis.family === "other" ? "language not specifically analysed" : analysis.family})`, profile),
    ...(risks === 0 ? [] : [...callout({ level: "warning", title: `${risks} possible ${risks === 1 ? "risk" : "risks"} found by pattern matching`, body: "These are patterns that often cause trouble, not proof of a problem. Check each one in the code." }, profile), blank()]),
    ...sideBySide(
      {
        left: { title: "Code", render: (width) => codeBlock({ code: content, language: languageFor(analysis.file), annotations, width, maxLines: options.maxLines }, withWidth(profile, width)) },
        right: { title: "Structure", render: (width) => structurePanel(analysis, options.expanded, withWidth(profile, width)) },
      },
      profile,
    ),
  ];
}

export interface ChangeViewOptions {
  /** At most this many changed lines per hunk are drawn. */
  maxHunkLines: number;
}

const diffLine = (sign: "+" | "-", text: string, profile: RenderProfile): Line =>
  fitLine([span(`${sign} `, { role: sign === "+" ? "success" : "error", bold: true }), span(text, { role: sign === "+" ? "success" : "error" })], profile.width, profile.symbols.ellipsis);

/** One file's change as a diff, with the symbols and risks it introduced or resolved. */
export function changeView(summary: ChangeSummary, profile: RenderProfile, options: ChangeViewOptions): Line[] {
  const risk = (r: RiskFinding): string => `line ${r.line}, ${r.severity}: ${r.message}`;
  const out: Line[] = [
    ...heading(summary.file, profile),
    ...(summary.added === 0 && summary.removed === 0 && !summary.approximate ? textLines("No changes compared with the committed version.", profile.width) : []),
    ...textLines(`+${summary.added} lines added, -${summary.removed} lines removed, ${summary.unchanged} unchanged.${summary.approximate ? " This file was too large for an exact line diff, so only the counts are approximate and no hunks are shown." : ""}`, profile.width),
  ];
  if (summary.symbolsAdded.length > 0) out.push(blank(), ...textLines(`Added: ${summary.symbolsAdded.join(", ")}`, profile.width, { role: "success" }));
  if (summary.symbolsRemoved.length > 0) out.push(blank(), ...textLines(`Removed: ${summary.symbolsRemoved.join(", ")}. Other code may still use ${summary.symbolsRemoved.length === 1 ? "it" : "them"}; run /jpe:impact on the file to see.`, profile.width, { role: "warning" }));
  for (const r of summary.risksIntroduced) out.push(blank(), ...callout({ level: r.severity === "high" ? "error" : "warning", title: "A possible risk was introduced", body: risk(r) }, profile));
  for (const r of summary.risksResolved) out.push(blank(), ...callout({ level: "success", title: "A possible risk no longer matches", body: risk(r) }, profile));
  for (const hunk of summary.hunks) {
    out.push(blank(), [span(`@@ -${hunk.beforeStart} +${hunk.afterStart} @@`, { role: "muted" })]);
    const lines: Line[] = [...hunk.removed.map((t) => diffLine("-", t, profile)), ...hunk.added.map((t) => diffLine("+", t, profile))];
    out.push(...lines.slice(0, options.maxHunkLines));
    if (lines.length > options.maxHunkLines) out.push([span(`${profile.symbols.ellipsis} ${lines.length - options.maxHunkLines} more changed lines in this hunk`, { role: "muted" })]);
  }
  return out;
}

export interface ReviewFile {
  summary: ChangeSummary;
  status: "modified" | "added" | "deleted";
  isTest: boolean;
}

export type NoteBasis = "confirmed" | "heuristic";

export interface ReviewNote {
  basis: NoteBasis;
  /** Plain English, naming the file and line where there is one. */
  text: string;
}

const LARGE_CHANGE_LINES = 300;

/** Review notes from the facts, each marked as a confirmed finding or only a heuristic. Pure, so it is tested directly. */
export function reviewNotes(files: readonly ReviewFile[]): ReviewNote[] {
  const notes: ReviewNote[] = [];
  for (const f of files) {
    for (const r of f.summary.risksIntroduced) notes.push({ basis: "confirmed", text: `${f.summary.file}:${r.line} introduces a possible ${r.severity} risk (a pattern match, not proof): ${r.message}` });
  }
  for (const f of files) {
    if (f.summary.symbolsRemoved.length > 0) notes.push({ basis: "confirmed", text: `${f.summary.file} no longer defines ${f.summary.symbolsRemoved.join(", ")}. Whether anything else still uses ${f.summary.symbolsRemoved.length === 1 ? "it" : "them"} has not been checked: run /jpe:impact on the file.` });
  }
  const deleted = files.filter((f) => f.status === "deleted");
  if (deleted.length > 0) notes.push({ basis: "confirmed", text: `${deleted.length} ${deleted.length === 1 ? "file was" : "files were"} deleted: ${deleted.map((f) => f.summary.file).join(", ")}.` });
  const sourceChanged = files.some((f) => !f.isTest && f.status !== "deleted");
  if (sourceChanged && !files.some((f) => f.isTest)) notes.push({ basis: "heuristic", text: "Source files changed and no test files did. That is a pattern worth a look, not a finding: the existing tests may already cover it." });
  const total = files.reduce((n, f) => n + f.summary.added + f.summary.removed, 0);
  if (total > LARGE_CHANGE_LINES) notes.push({ basis: "heuristic", text: `${total} lines changed. Large changes are harder to review well; consider whether it can be split.` });
  return notes;
}

const riskCounts = (summary: ChangeSummary): string => {
  const by = (s: RiskFinding["severity"]): number => summary.risksIntroduced.filter((r) => r.severity === s).length;
  const parts = [`${by("high")} high`, `${by("medium")} medium`, `${by("low")} low`].filter((p) => !p.startsWith("0 "));
  return parts.length === 0 ? "none found" : parts.join(", ");
};

export interface ReviewViewOptions {
  expanded: boolean;
  maxHunkLines: number;
  /** Files that were not analysed, with the reason (too large, unreadable). */
  skipped: readonly string[];
  /** Where the recorded review decision stands for these changes; shown when known. */
  decision?: ReviewDecisionState;
}

/** The recorded decision as a status line. A stale decision is shown as stale, never as if it still applied. */
export function decisionLines(decision: ReviewDecisionState, profile: RenderProfile): Line[] {
  const note = decision.note === undefined ? [] : textLines(`Note: ${decision.note}`, profile.width, { role: "muted" });
  if (decision.state === "none") return statusBadge("inactive", "No review decision recorded for these changes", profile);
  if (decision.state === "stale") return [...statusBadge("warning", `Stale: the last decision (${decision.decision ?? "recorded"}) was about different changes than these`, profile), ...note];
  return [...statusBadge(decision.decision === "rejected" ? "error" : "success", `${decision.decision === "rejected" ? "Rejected" : "Approved"}, and these changes are unchanged since`, profile), ...note];
}

/** A review of every changed file: overview table, notes with their basis, a checklist, and each file's diff. */
export function reviewView(files: readonly ReviewFile[], profile: RenderProfile, options: ReviewViewOptions): Line[] {
  const notes = reviewNotes(files);
  const introduced = files.reduce((n, f) => n + f.summary.risksIntroduced.length, 0);
  const out: Line[] = [...heading("Code review of uncommitted changes", profile)];
  if (files.length === 0) {
    if (options.skipped.length === 0) return [...out, ...textLines("There are no uncommitted changes to review.", profile.width)];
    // Changes exist but none could be analysed: say so, and why, rather than claiming there is nothing to review.
    return [...out, ...textLines("There are uncommitted changes, but none of the changed files could be analysed.", profile.width), blank(), ...callout({ level: "info", title: `${options.skipped.length} ${options.skipped.length === 1 ? "file was" : "files were"} not analysed`, body: options.skipped.join("; ") }, profile)];
  }

  if (options.decision !== undefined) out.push(...decisionLines(options.decision, profile), blank());
  out.push(
    ...textLines(`${files.length} ${files.length === 1 ? "file" : "files"} changed. ${introduced === 0 ? "No possible risks were introduced by pattern matching (that does not prove the change is correct)." : `${introduced} possible ${introduced === 1 ? "risk" : "risks"} introduced (pattern matches, not proof).`}`, profile.width),
    blank(),
    ...table(
      {
        columns: [{ header: "File", min: 12 }, { header: "Kind", min: 8 }, { header: "Lines", min: 8 }, { header: "Risks introduced", min: 10 }],
        rows: files.map((f) => [f.summary.file, `${f.status}${f.isTest ? ", test" : ""}`, `+${f.summary.added} -${f.summary.removed}`, riskCounts(f.summary)]),
      },
      profile,
    ),
  );
  if (options.skipped.length > 0) out.push(blank(), ...callout({ level: "info", title: `${options.skipped.length} ${options.skipped.length === 1 ? "file was" : "files were"} not analysed`, body: options.skipped.join("; ") }, profile));

  if (notes.length > 0) {
    out.push(blank(), ...heading("Review notes", profile));
    for (const n of notes) out.push(...textLines(`[${n.basis}] ${n.text}`, profile.width, { role: n.basis === "confirmed" ? "warning" : "muted" }));
  }
  out.push(blank(), ...heading("Checklist for the reviewer", profile), ...bulletList(checklist(files), profile));

  out.push(blank(), ...heading("Changes", profile));
  files.forEach((f, i) => {
    out.push(...section({ title: `${f.summary.file}  +${f.summary.added} -${f.summary.removed}`, body: changeView(f.summary, profile, { maxHunkLines: options.maxHunkLines }), expanded: options.expanded && i < 5 }, profile));
  });
  return out;
}

/** What a reviewer should confirm, derived from the findings above. Never claims the change is correct. */
export function checklist(files: readonly ReviewFile[]): string[] {
  const items: string[] = [];
  const risky = files.flatMap((f) => f.summary.risksIntroduced.map((r) => `${f.summary.file}:${r.line}`));
  if (risky.length > 0) items.push(`Confirm each possible risk is intended: ${risky.slice(0, 8).join(", ")}${risky.length > 8 ? ", ..." : ""}.`);
  if (files.some((f) => f.summary.symbolsRemoved.length > 0)) items.push("Confirm nothing still uses the removed symbols (/jpe:impact).");
  items.push("Read each diff below; the tool can find patterns but cannot judge intent.");
  if (files.some((f) => !f.isTest && f.status !== "deleted")) items.push("Run the project's checks after approving (/jpe:verify).");
  return items;
}

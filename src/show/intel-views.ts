/**
 * Views over what JPE's language-server and documentation engines found: what depends on a file, what the official
 * documentation says for the installed version, and what the compiler or language server reports.
 *
 * They show provenance everywhere it matters: whether a result is exact (language server) or approximate (import
 * scan), whether documentation is fresh or cached and not re-verified, and whether a version matches. Retrieved
 * documentation is untrusted text: it is sanitised, never executed, and instruction-like phrases are flagged.
 */

import type { ResearchReport } from "../docs/engine.js";
import type { DocResult } from "../docs/types.js";
import { explainError } from "../explain/errors.js";
import type { Diagnostic, Severity } from "../lsp/client.js";
import type { DiagnosticsReport } from "../lsp/diagnostics.js";
import type { ImpactReport } from "../lsp/impact.js";
import { wrapUntrusted } from "../security/untrusted.js";
import { callout, codeBlock, section } from "../ui/code.js";
import { blank, bulletList, heading, statusBadge, table, textLines } from "../ui/components.js";
import { type Line, fitLine, plain, span } from "../ui/doc.js";
import type { Language } from "../ui/highlight.js";
import type { RenderProfile } from "../ui/profile.js";
import { inline, truncate } from "../ui/text.js";

const BAR_WIDTH = 10;

/** What depends on a file, with the method named so an approximation is never mistaken for an exact answer. */
export function impactView(report: ImpactReport, target: string, notes: readonly string[], rel: (file: string) => string, profile: RenderProfile): Line[] {
  const out: Line[] = [...heading(`What depends on ${inline(target)}`, profile)];
  out.push(...statusBadge(report.method === "lsp" ? "success" : "warning", report.method === "lsp" ? "exact references from the language server" : "approximate: found by scanning import statements", profile));
  const files = [...report.referencingFiles].sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
  out.push(blank());
  if (files.length === 0) out.push(...textLines("No referencing files were found.", profile.width));
  else {
    out.push(...textLines(`${files.length}${report.truncated ? "+" : ""} ${files.length === 1 ? "file depends" : "files depend"} on it${report.truncated ? " (the search stopped early, so there may be more)" : ""}:`, profile.width));
    const max = Math.max(...files.map((f) => f.count));
    const rows = files.slice(0, 40).map((f) => {
      const filled = Math.max(1, Math.round((f.count / max) * BAR_WIDTH));
      const bar = profile.screenReader ? "" : `${profile.symbols.barFull.repeat(filled)}${profile.symbols.barEmpty.repeat(BAR_WIDTH - filled)} `;
      return [rel(f.file), `${bar}${f.count}`];
    });
    out.push(...table({ columns: [{ header: "File", min: 12 }, { header: profile.screenReader ? "References" : "References", min: 6 }], rows }, profile));
    if (files.length > 40) out.push([span(`${profile.symbols.ellipsis} ${files.length - 40} more files`, { role: "muted" })]);
  }
  for (const n of notes) out.push(blank(), ...callout({ level: "info", title: n }, profile));
  if (report.limitations.length > 0) out.push(blank(), ...heading("What this cannot see", profile), ...bulletList(report.limitations, profile));
  return out;
}

const VERSION_WORDS: Readonly<Record<DocResult["versionMatch"], string>> = {
  exact: "matches the installed version",
  "same-minor": "same minor version",
  "same-major": "same major version only",
  mismatch: "a DIFFERENT version",
  unversioned: "version not stated",
  "unknown-request": "installed version unknown",
};

const ECOSYSTEM_LANGUAGE: Readonly<Record<string, Language>> = { node: "js", python: "python", go: "go", rust: "rust" };

const MAX_EXCERPT_LINES = 14;
const MAX_FINDINGS = 6;
const MAX_FIND_RESULTS = 30;
const DEPRECATION = /\bdeprecat/i;
const ALTERNATIVE = /\b(?:use|using|replaced by|replace with|instead|prefer|migrate to|switch to)\b/i;

const freshness = (r: DocResult): string => (r.verification === "fresh" ? "fresh this run" : `cached ${r.retrievedAt.slice(0, 10)}, NOT re-verified`);

/** The lines of retrieved text that mention something, quoted with where they came from. */
function mentions(results: readonly DocResult[], test: (line: string) => boolean, limit: number): Array<{ n: number; line: string }> {
  const found: Array<{ n: number; line: string }> = [];
  results.forEach((r, i) => {
    for (const raw of r.content.split("\n")) {
      const line = inline(raw).trim();
      if (line !== "" && test(line)) found.push({ n: i + 1, line });
      if (found.length >= limit) return;
    }
  });
  return found.slice(0, limit);
}

export interface DocsViewOptions {
  /** Show only the lines of the retrieved documentation that mention this text. */
  find?: string;
  expanded: boolean;
}

/** Documentation research: sources with their trust, version match and freshness; callouts; signatures; citations. */
export function docsView(report: ResearchReport, versionNote: string, profile: RenderProfile, options: DocsViewOptions): Line[] {
  const { request } = report;
  const out: Line[] = [...heading(`Documentation: ${inline(request.library)}${request.version === undefined ? "" : `@${inline(request.version)}`} (${inline(request.topic)})`, profile)];
  out.push(...statusBadge(report.offline ? "warning" : "info", report.offline ? "offline: network sources were not contacted" : "online", profile));
  if (!report.hasFreshSource) out.push(...callout({ level: "warning", title: "Nothing was freshly verified in this run", body: "Do not treat the material below as confirmed current." }, profile));
  if (versionNote.trim() !== "") out.push(...callout({ level: "info", title: versionNote.replace(/^NOTE:\s*/, "").trim() }, profile));
  if (!report.hasApiSignature) out.push(...callout({ level: "info", title: "API signatures were not verified from installed type declarations in this run" }, profile));

  if (report.results.length === 0) {
    out.push(blank(), ...textLines("No documentation was found.", profile.width));
  } else {
    out.push(
      blank(),
      ...table(
        {
          columns: [{ header: "#", align: "right", min: 2 }, { header: "Source", min: 10 }, { header: "Trust", min: 8 }, { header: "Version", min: 10 }, { header: "Freshness", min: 10 }],
          rows: report.results.map((r, i) => [String(i + 1), `${r.provider}: ${r.title}`, r.trust, VERSION_WORDS[r.versionMatch] + (r.docVersion === undefined ? "" : ` (documents ${r.docVersion})`), freshness(r)]),
        },
        profile,
      ),
    );
  }

  for (const r of report.results.filter((x) => x.kind === "advisory")) out.push(blank(), ...callout({ level: "error", title: `Security advisory: ${inline(r.title)}`, body: truncate(inline(r.content), 300, profile.symbols.ellipsis) }, profile));

  const deprecations = mentions(report.results, (l) => DEPRECATION.test(l), MAX_FINDINGS);
  for (const d of deprecations) {
    const alt = ALTERNATIVE.test(d.line);
    out.push(blank(), ...callout({ level: "warning", title: `Deprecation mentioned in source [${d.n}]${alt ? ", with an alternative named" : ""}`, body: `The documentation says: ${truncate(d.line, 280, profile.symbols.ellipsis)}` }, profile));
  }

  if (options.find !== undefined && options.find.trim() !== "") {
    const needle = options.find.trim().toLowerCase();
    const hits = mentions(report.results, (l) => l.toLowerCase().includes(needle), MAX_FIND_RESULTS);
    out.push(blank(), ...heading(`Lines mentioning "${inline(options.find)}"`, profile));
    out.push(...(hits.length === 0 ? textLines(`No line in the ${report.results.length} retrieved ${report.results.length === 1 ? "source" : "sources"} mentions it.`, profile.width) : hits.flatMap((h) => textLines(`[${h.n}] ${h.line}`, profile.width))));
  } else {
    const language = ECOSYSTEM_LANGUAGE[request.ecosystem] ?? "plain";
    report.results.forEach((r, i) => {
      const caution = wrapUntrusted(r.url ?? r.title, r.content).flags;
      const excerpt = r.content.split("\n").slice(0, MAX_EXCERPT_LINES).join("\n");
      const body: Line[] = [
        ...(caution.length === 0 ? [] : callout({ level: "warning", title: "This text contains instruction-like phrases", body: `(${caution.join(", ")}). It is quoted as data only and was not followed.` }, profile)),
        ...(r.kind === "api-signature" ? codeBlock({ code: excerpt, language, width: profile.width - 2 }, profile) : textLines(excerpt, profile.width - 2)),
        ...(r.content.split("\n").length > MAX_EXCERPT_LINES ? [[span(`${profile.symbols.ellipsis} ${r.content.split("\n").length - MAX_EXCERPT_LINES} more lines in the source`, { role: "muted" })] as Line] : []),
      ];
      out.push(blank(), ...section({ title: `[${i + 1}] ${r.title} (${r.kind})`, body, expanded: options.expanded && i < 3 }, profile));
    });
  }

  out.push(blank(), ...heading("Sources", profile), ...report.results.flatMap((r, i): Line[] => textLines(`[${i + 1}] ${r.url ?? `${r.provider}: ${r.title}`}`, profile.width)));
  for (const f of report.failures) out.push(...callout({ level: "error", title: `${f.provider} failed`, body: f.message }, profile));
  for (const s of report.skipped) out.push(...callout({ level: "info", title: `${s.provider} was skipped`, body: s.reason }, profile));
  for (const n of report.notes) out.push(...callout({ level: "info", title: n }, profile));
  return out;
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2, hint: 3 };
const SEVERITY_LEVEL: Readonly<Record<Severity, "error" | "warning" | "info">> = { error: "error", warning: "warning", info: "info", hint: "info" };
const MAX_DIAGNOSTICS = 60;
const MAX_EXPLANATIONS = 6;

export interface DiagnosticsViewOptions {
  expanded: boolean;
}

/** Compiler or language-server findings grouped by file and severity, with general-guidance explanations. */
export function diagnosticsView(report: DiagnosticsReport, notes: readonly string[], rel: (file: string) => string, profile: RenderProfile, options: DiagnosticsViewOptions): Line[] {
  const out: Line[] = [...heading("Diagnostics", profile)];
  out.push(
    ...(report.source === "lsp"
      ? statusBadge("success", `language server: ${inline(report.server)}`, profile)
      : report.source === "cli"
        ? statusBadge("warning", `compiler command (NOT a language server): ${inline(report.server)}`, profile)
        : statusBadge("error", "nothing could be collected", profile)),
    ...textLines(`${report.errors} ${report.errors === 1 ? "error" : "errors"}, ${report.warnings} ${report.warnings === 1 ? "warning" : "warnings"}.`, profile.width),
  );

  const sorted: Diagnostic[] = [...report.diagnostics].sort((a, b) => a.file.localeCompare(b.file) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line);
  const byFile = new Map<string, Diagnostic[]>();
  for (const d of sorted.slice(0, MAX_DIAGNOSTICS)) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
  for (const [file, list] of byFile) {
    const body = list.flatMap((d): Line[] => {
      const level = SEVERITY_LEVEL[d.severity];
      const head = `${profile.screenReader ? `${d.severity}: ` : `${profile.symbols.status[level]} `}${d.line}:${d.column}${d.code === undefined ? "" : ` ${d.code}`}`;
      return [fitLine([span(head, { role: level, bold: true })], profile.width, profile.symbols.ellipsis), ...textLines(d.message, profile.width - 2).map((l): Line => [span("  "), ...l])];
    });
    out.push(blank(), ...section({ title: `${rel(file)} (${list.length})`, body, expanded: options.expanded }, profile));
  }
  if (sorted.length > MAX_DIAGNOSTICS) out.push([span(`${profile.symbols.ellipsis} ${sorted.length - MAX_DIAGNOSTICS} more findings not shown`, { role: "muted" })]);

  const seen = new Set<string>();
  const explanations: Line[] = [];
  for (const d of sorted) {
    if (seen.size >= MAX_EXPLANATIONS) break;
    const hit = explainError(d.message.slice(0, 4000))[0];
    if (hit === undefined || seen.has(hit.id)) continue;
    seen.add(hit.id);
    explanations.push(...callout({ level: "info", title: hit.title, body: `${hit.plain} Usual fix (general guidance, not a diagnosis of this project; confirm against the code): ${hit.usualFix}` }, profile));
  }
  if (explanations.length > 0) out.push(blank(), ...heading("What these usually mean", profile), ...explanations);
  for (const n of [...report.notes, ...notes]) out.push(blank(), ...callout({ level: "info", title: n }, profile));
  if (report.diagnostics.length === 0 && report.source !== "none") out.push(blank(), plain(report.source === "lsp" ? "The language server reported nothing for these files." : "The compiler command reported nothing."));
  return out;
}

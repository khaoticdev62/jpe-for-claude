import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { JpeError } from "../../core/errors.js";
import { EvidenceLedger } from "../../core/ledger.js";
import { checkServer, detectLanguages, findOnPath, listProjectFiles, type PathLookup } from "../../lsp/detect.js";
import { collectCliDiagnostics, collectLspDiagnostics, recordLspEvidence, type DiagnosticsReport } from "../../lsp/diagnostics.js";
import { LspClient } from "../../lsp/client.js";
import { impactViaLsp, impactViaText, type ImpactReport } from "../../lsp/impact.js";
import { LANGUAGES, getLanguage, languageForFile, planInstall, type LanguageId } from "../../lsp/registry.js";
import { resolveInside } from "../../security/paths.js";
import { flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";

function lookupFor(ctx: CliContext): PathLookup {
  return { platform: ctx.pathEnv.platform, env: ctx.pathEnv.env, exists: (f) => ctx.fs.exists(f) };
}

const rel = (ctx: CliContext, file: string): string => path.relative(ctx.cwd, file).split(path.sep).join("/") || file;

function formatDiagnostics(ctx: CliContext, report: DiagnosticsReport): string[] {
  return [
    `Source: ${report.source === "lsp" ? "language server" : report.source === "cli" ? "compiler command (NOT a language server)" : "none"} — ${report.server}`,
    `Errors: ${report.errors}, warnings: ${report.warnings}`,
    ...report.diagnostics.slice(0, 50).map((d) => `  ${rel(ctx, d.file)}:${d.line}:${d.column} ${d.severity}${d.code ? ` ${d.code}` : ""}: ${d.message}`),
    ...(report.diagnostics.length > 50 ? [`  ...and ${report.diagnostics.length - 50} more`] : []),
    ...report.notes.map((n) => `NOTE: ${n}`),
  ];
}

async function statusSub(ctx: CliContext): Promise<number> {
  const files = await listProjectFiles(ctx.cwd, ctx.git);
  const languages = detectLanguages(files);
  if (languages.length === 0) {
    ctx.out("No supported source files were found in this project.");
    return 0;
  }
  const lookup = lookupFor(ctx);
  const seen = new Set<string>();
  const lines = ["Languages and their language servers:"];
  for (const { language, files: count } of languages) {
    const status = await checkServer(language, { lookup, run: ctx.run, cwd: ctx.cwd, timeoutMs: 10_000 });
    lines.push(`- ${language.name} (${count} files): ${status.state.toUpperCase()} — ${status.detail}`);
    if (status.state === "missing" && !seen.has(language.server.binary)) {
      seen.add(language.server.binary);
      if (language.server.nativePlugin) lines.push(`    Claude Code plugin: ${language.server.nativePlugin} (install the ${language.server.binary} binary first, then /plugin install ${language.server.nativePlugin}@claude-plugins-official)`);
      lines.push(`    Run \`jpe install-plan ${language.id}\` to see install options.`);
    }
  }
  lines.push("", "READY means the version command ran. Only a start-up test (jpe lsp diagnostics) proves the server answers LSP requests.");
  ctx.out(lines.join("\n"));
  return 0;
}

export interface DiagnosticsRun {
  report: DiagnosticsReport;
  /** Plain-English remarks, for example that the language server is not installed so the results are not LSP-verified. */
  notes: string[];
}

/**
 * Collects diagnostics for files that share one language server (the server if installed, else the compiler command,
 * labelled as such) and records what was observed in the evidence ledger. Shared by `jpe lsp diagnostics` and
 * `jpe show diagnostics`.
 */
export async function collectDiagnostics(inputs: readonly string[], ctx: CliContext): Promise<DiagnosticsRun> {
  if (inputs.length === 0) throw new JpeError("INVALID_INPUT", "Usage: jpe lsp diagnostics <file> [more files]");
  const cfg = await ctx.loadConfig();
  const files = inputs.map((f) => resolveInside(ctx.cwd, f));
  const first = languageForFile(files[0] ?? "");
  if (!first) throw new JpeError("INVALID_INPUT", `JPE has no language server entry for "${inputs[0]}".`);
  const language = first.language;
  const mixed = files.filter((f) => languageForFile(f)?.language.server.binary !== language.server.binary);
  if (mixed.length > 0) throw new JpeError("INVALID_INPUT", "All files in one call must use the same language server.");

  const binary = await findOnPath(language.server.binary, lookupFor(ctx));
  const report = binary
    ? await collectLspDiagnostics(language, { command: binary, args: language.server.args, rootDir: ctx.cwd, files, readFile: (f) => readFile(f, "utf8"), startupTimeoutMs: cfg.lsp.diagnosticsTimeoutMs, maxWaitMs: cfg.lsp.diagnosticsTimeoutMs })
    : await collectCliDiagnostics(language, { run: ctx.run, cwd: ctx.cwd, timeoutMs: cfg.engineering.commandTimeoutMs });

  const ledger = new EvidenceLedger({ now: ctx.now, newId: ctx.newId });
  recordLspEvidence(ledger, report);
  const ledgerFile = path.join(ctx.stateDir(), "ledger.jsonl");
  await mkdir(path.dirname(ledgerFile), { recursive: true });
  await appendFile(ledgerFile, `${ledger.toJsonLines()}\n`);

  const notes = binary ? [] : [`The ${language.server.binary} language server is not installed, so these results were NOT verified by LSP. See \`jpe install-plan ${language.id}\`.`];
  return { report, notes };
}

async function diagnosticsSub(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const { report, notes } = await collectDiagnostics(args.positionals.slice(1), ctx);
  ctx.out([...formatDiagnostics(ctx, report), ...notes].join("\n"));
  return report.source === "lsp" && report.errors > 0 ? 1 : 0;
}

export interface ImpactRun {
  report: ImpactReport;
  /** Absolute path of the file asked about. */
  abs: string;
  /** Remarks about what was tried, for example that the language server failed and import scanning was used. */
  notes: string[];
}

/**
 * Finds what depends on a file: exact references from the language server when a position is given and a server is
 * installed, otherwise by scanning imports (labelled as approximate). Shared by `jpe impact` and `jpe show impact`.
 */
export async function computeImpact(target: string | undefined, line: number, column: number, ctx: CliContext): Promise<ImpactRun> {
  if (!target) throw new JpeError("INVALID_INPUT", "Usage: jpe impact <file> [--line N --column N]");
  const abs = resolveInside(ctx.cwd, target);
  const hit = languageForFile(abs);
  let report: ImpactReport | undefined;
  const notes: string[] = [];

  if (hit && Number.isInteger(line) && line > 0 && Number.isInteger(column) && column > 0) {
    const binary = await findOnPath(hit.language.server.binary, lookupFor(ctx));
    if (binary) {
      try {
        const client = await LspClient.start({ command: binary, args: hit.language.server.args, rootDir: ctx.cwd, startupTimeoutMs: 30_000 });
        try {
          await client.openFromDisk(abs, hit.languageId);
          report = await impactViaLsp(client, abs, { line, column });
        } finally {
          await client.dispose();
        }
      } catch (error) {
        notes.push(`Language server failed (${error instanceof JpeError ? error.userMessage : "unexpected error"}); fell back to import scanning.`);
      }
    } else notes.push(`${hit.language.server.binary} is not installed; used import scanning instead.`);
  }
  report ??= await impactViaText(target, { root: ctx.cwd, listFiles: () => listProjectFiles(ctx.cwd, ctx.git), readText: (f) => ctx.fs.readText(f) });
  return { report, abs, notes };
}

async function impactSub(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const { report, abs, notes } = await computeImpact(args.positionals[0], Number(flagString(args, "line")), Number(flagString(args, "column")), ctx);
  ctx.out(
    [
      `Impact analysis for ${rel(ctx, abs)} (${report.method === "lsp" ? "language server: exact references" : "import scanning"})`,
      report.referencingFiles.length === 0 ? "No referencing files found." : `${report.referencingFiles.length} file(s)${report.truncated ? "+" : ""} depend on it:`,
      ...report.referencingFiles.slice(0, 50).map((r) => `  ${rel(ctx, r.file)} (${r.count})`),
      ...notes.map((n) => `NOTE: ${n}`),
      ...report.limitations.map((l) => `LIMIT: ${l}`),
    ].join("\n"),
  );
  return 0;
}

/** `jpe lsp status|diagnostics`. */
export async function lspCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const sub = args.positionals[0];
  if (sub === "status") return statusSub(ctx);
  if (sub === "diagnostics") return diagnosticsSub(args, ctx);
  throw new JpeError("INVALID_INPUT", "Usage: jpe lsp status | jpe lsp diagnostics <file...>");
}

export const impactCommand = impactSub;

/** `jpe install-plan <language>`: shows install options. Never runs them. */
export async function installPlanCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const id = args.positionals[0];
  const language = LANGUAGES.find((l) => l.id === id);
  if (!id || !language) throw new JpeError("INVALID_INPUT", `Usage: jpe install-plan <${LANGUAGES.map((l) => l.id).join("|")}>`);
  const lookup = lookupFor(ctx);
  const tools = new Set<string>();
  for (const o of language.server.install) if (await findOnPath(o.requires, lookup)) tools.add(o.requires);
  const plan = planInstall(getLanguage(id as LanguageId), ctx.pathEnv.platform, (t) => tools.has(t));
  ctx.out(
    [
      `Install plan for the ${language.name} language server (${plan.binary}) on ${ctx.pathEnv.platform}`,
      `Source of these commands: ${plan.confidence === "docs" ? "Claude Code documentation" : "the server project's usual install method (advisory: confirm before running)"}`,
      plan.available.length === 0 ? "No scripted option is runnable on this machine." : "Options you can approve:",
      "Nothing has been run. This command only shows options.",
      ...plan.available.map((o) => `  ${o.file} ${o.args.join(" ")}`),
      ...plan.blocked.map((b) => `  (needs ${b.missing} first) ${b.option.file} ${b.option.args.join(" ")}`),
      ...(plan.manual ? [`Manual: ${plan.manual}`] : []),
      ...(plan.nativePlugin ? [`Then in Claude Code: /plugin install ${plan.nativePlugin}@claude-plugins-official`] : []),
    ].join("\n"),
  );
  return 0;
}

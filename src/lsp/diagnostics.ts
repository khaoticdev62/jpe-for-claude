import path from "node:path";
import type { EvidenceLedger } from "../core/ledger.js";
import { isJpeError } from "../core/errors.js";
import { runCommand, type RunOptions, type RunResult } from "../security/run.js";
import { LspClient, type Diagnostic } from "./client.js";
import { languageForFile, type LanguageSpec } from "./registry.js";

export interface DiagnosticsReport {
  language: string;
  /** lsp = a real language server answered; cli = parsed from a compiler command; none = nothing could be collected. */
  source: "lsp" | "cli" | "none";
  /** Name shown in the evidence ledger, for example "typescript-language-server" or "tsc (CLI fallback)". */
  server: string;
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  files: string[];
  /** Plain-English explanation of limits (server missing, timed out, not settled...). */
  notes: string[];
}

const count = (list: readonly Diagnostic[], severity: Diagnostic["severity"]): number => list.filter((d) => d.severity === severity).length;

/**
 * Parses compiler-style output: tsc / MSBuild "file(line,col): error CODE: msg", GNU-style
 * "file:line:col: error: msg" and `go vet` "file:line:col: msg", and rustc's two-line form.
 */
export function parseCompilerOutput(output: string, cwd: string): Diagnostic[] {
  const found: Diagnostic[] = [];
  const abs = (f: string): string => path.resolve(cwd, f.trim());
  const lines = output.split(/\r?\n/);
  lines.forEach((line, i) => {
    let m = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+([A-Za-z]+\d+)?:?\s*(.*)$/.exec(line);
    if (m?.[1] && m[2] && m[3] && m[4]) {
      found.push({ file: abs(m[1]), line: Number(m[2]), column: Number(m[3]), severity: m[4] as Diagnostic["severity"], message: (m[6] ?? "").replace(/\s*\[[^\]]+\.csproj\]\s*$/, ""), ...(m[5] ? { code: m[5] } : {}) });
      return;
    }
    m = /^(.+?):(\d+):(\d+):\s*(?:(error|warning|note)[:\s]\s*)?(.+)$/.exec(line);
    if (m?.[1] && m[2] && m[3] && m[5] && !/^[A-Za-z]$/.test(m[1])) {
      const sev = m[4] === "warning" ? "warning" : m[4] === "note" ? "info" : "error";
      found.push({ file: abs(m[1]), line: Number(m[2]), column: Number(m[3]), severity: sev, message: m[5] });
      return;
    }
    m = /^(error|warning)(?:\[([A-Za-z0-9]+)\])?:\s*(.+)$/.exec(line);
    const loc = /^\s*-->\s*(.+?):(\d+):(\d+)/.exec(lines[i + 1] ?? "");
    if (m?.[1] && m[3] && loc?.[1] && loc[2] && loc[3]) {
      found.push({ file: abs(loc[1]), line: Number(loc[2]), column: Number(loc[3]), severity: m[1] as Diagnostic["severity"], message: m[3], ...(m[2] ? { code: m[2] } : {}) });
    }
  });
  return found;
}

export interface LspCollectOptions {
  command: string;
  args: readonly string[];
  rootDir: string;
  files: readonly string[];
  readFile: (file: string) => Promise<string>;
  startupTimeoutMs: number;
  settleMs?: number;
  maxWaitMs?: number;
}

/** Real diagnostics from a running language server for the given files. */
export async function collectLspDiagnostics(language: LanguageSpec, options: LspCollectOptions): Promise<DiagnosticsReport> {
  const base = { language: language.id, server: language.server.binary, files: [...options.files] };
  let client: LspClient;
  try {
    client = await LspClient.start({ command: options.command, args: options.args, rootDir: options.rootDir, startupTimeoutMs: options.startupTimeoutMs });
  } catch (error) {
    const reason = isJpeError(error) ? error.userMessage : "The language server failed to start.";
    return { ...base, source: "none", diagnostics: [], errors: 0, warnings: 0, notes: [`Language server did not start: ${reason}`] };
  }
  try {
    for (const file of options.files) {
      const hit = languageForFile(file);
      client.openFile(file, hit?.languageId ?? language.id, await options.readFile(file));
    }
    const { diagnostics, settled } = await client.waitForDiagnostics(options.files, options.settleMs ?? 1500, options.maxWaitMs ?? 20_000);
    const notes = settled ? [] : ["The server had not finished reporting when the wait limit was reached; results may be incomplete."];
    return { ...base, server: client.serverName ?? language.server.binary, source: "lsp", diagnostics, errors: count(diagnostics, "error"), warnings: count(diagnostics, "warning"), notes };
  } finally {
    await client.dispose();
  }
}

export interface CliFallbackDeps {
  run: (options: RunOptions) => Promise<RunResult>;
  cwd: string;
  timeoutMs: number;
}

/** Missing-server fallback: run the language's compiler check and parse its output. Not LSP, and labelled so. */
export async function collectCliDiagnostics(language: LanguageSpec, deps: CliFallbackDeps = { run: runCommand, cwd: process.cwd(), timeoutMs: 120_000 }): Promise<DiagnosticsReport> {
  const fb = language.fallback;
  const base = { language: language.id, files: [] as string[] };
  if (!fb) {
    return { ...base, source: "none", server: language.server.binary, diagnostics: [], errors: 0, warnings: 0, notes: [`No language server and no command-line fallback are available for ${language.name}.`] };
  }
  const label = `${fb.file} (CLI fallback)`;
  try {
    const r = await deps.run({ file: fb.file, args: fb.args, cwd: deps.cwd, timeoutMs: deps.timeoutMs });
    const diagnostics = parseCompilerOutput(`${r.stdout}\n${r.stderr}`, deps.cwd);
    const notes = ["These diagnostics come from a compiler command, not from a language server."];
    if (r.exitCode !== 0 && diagnostics.length === 0) notes.push(`${fb.file} failed (exit ${r.exitCode}) but its output could not be read as diagnostics${fb.note ? `; ${fb.note}` : ""}.`);
    if (r.timedOut) notes.push("The command timed out.");
    return { ...base, source: "cli", server: label, diagnostics, errors: count(diagnostics, "error"), warnings: count(diagnostics, "warning"), notes };
  } catch (error) {
    const reason = isJpeError(error) ? error.userMessage : "unexpected failure";
    return { ...base, source: "none", server: label, diagnostics: [], errors: 0, warnings: 0, notes: [`The fallback command could not run: ${reason}`] };
  }
}

/**
 * Records a diagnostics report as evidence. Only a real language server counts as LSP evidence;
 * a CLI fallback or an unavailable server is recorded as "unavailable" so it can never verify a change.
 */
export function recordLspEvidence(ledger: EvidenceLedger, report: DiagnosticsReport): void {
  ledger.recordLsp({ server: report.server, available: report.source === "lsp", errors: report.source === "lsp" ? report.errors : 0, warnings: report.source === "lsp" ? report.warnings : 0 });
}

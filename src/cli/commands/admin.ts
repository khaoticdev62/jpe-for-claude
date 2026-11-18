import { copyFile } from "node:fs/promises";
import path from "node:path";
import { globalConfigPath, projectConfigPath } from "../../config/paths.js";
import { partialConfigSchema, configSchema } from "../../config/schema.js";
import { deepMerge } from "../../config/load.js";
import { defaultConfig } from "../../config/defaults.js";
import { exportConfig, importConfig } from "../../config/portable.js";
import { migrateConfig } from "../../config/migrate.js";
import { JpeError } from "../../core/errors.js";
import { analyzeCode, familyOf } from "../../explain/analyze.js";
import { listProjectFiles } from "../../lsp/detect.js";
import { BackupStore } from "../../recovery/backup.js";
import { resolveInside } from "../../security/paths.js";
import { isSensitiveFileName, scanText } from "../../security/scan.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";

type Plain = Record<string, unknown>;

export function scopeFile(args: ParsedArgs, ctx: CliContext): string {
  return flagBool(args, "project") ? projectConfigPath(ctx.cwd) : globalConfigPath(ctx.pathEnv);
}

/** Writes a validated config file for one scope, keeping a timestamped copy of the file it replaces. */
export async function writeScope(ctx: CliContext, file: string, content: Plain): Promise<string[]> {
  const notes: string[] = [];
  if ((await ctx.readText(file)) !== undefined) {
    const backup = `${file}.bak-${ctx.now().toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(file, backup);
    notes.push(`Previous file kept as ${backup}`);
  }
  await ctx.writeText(file, `${JSON.stringify(content, null, 2)}\n`);
  return notes;
}

function setPath(target: Plain, dotted: string, value: unknown): Plain {
  const keys = dotted.split(".");
  if (keys.some((k) => k === "" || k === "__proto__" || k === "constructor" || k === "prototype")) throw new JpeError("INVALID_INPUT", `"${dotted}" is not a valid setting name.`);
  const root: Plain = { ...target };
  let cursor = root;
  keys.slice(0, -1).forEach((k) => {
    const next = cursor[k];
    cursor[k] = typeof next === "object" && next !== null && !Array.isArray(next) ? { ...(next as Plain) } : {};
    cursor = cursor[k] as Plain;
  });
  cursor[keys[keys.length - 1] as string] = value;
  return root;
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** `jpe config show|path|set|export|import`. */
export async function configCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const [sub, ...rest] = args.positionals;
  if (sub === "show") {
    ctx.out(JSON.stringify(await ctx.loadConfig(), null, 2));
    return 0;
  }
  if (sub === "path") {
    ctx.out(`global:  ${globalConfigPath(ctx.pathEnv)}\nproject: ${projectConfigPath(ctx.cwd)}`);
    return 0;
  }
  if (sub === "set") {
    const [key, raw] = rest;
    if (!key || raw === undefined) throw new JpeError("INVALID_INPUT", "Usage: jpe config set <section.setting> <value> [--project]");
    const file = scopeFile(args, ctx);
    const existingText = await ctx.readText(file);
    const existing: Plain = existingText ? migrateConfig(JSON.parse(existingText)) : {};
    const updated = setPath(existing, key, parseValue(raw));
    const check = partialConfigSchema.safeParse(updated);
    const merged = configSchema.safeParse(deepMerge(defaultConfig(), updated));
    if (!check.success || !merged.success) {
      const issues = (check.success ? merged.success ? [] : merged.error.issues : check.error.issues).map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ");
      throw new JpeError("INVALID_CONFIG", `That value is not allowed: ${issues}`);
    }
    const notes = await writeScope(ctx, file, { ...updated, schemaVersion: 1 });
    ctx.out([`Set ${key} = ${JSON.stringify(parseValue(raw))} in ${file}`, ...notes].join("\n"));
    return 0;
  }
  if (sub === "export") {
    const { json, removed } = exportConfig(await ctx.loadConfig());
    const out = flagString(args, "out");
    if (out) {
      await ctx.writeText(resolveInside(ctx.cwd, out), json);
      ctx.out(`Exported to ${out}${removed.length ? ` (removed secret-looking fields: ${removed.join(", ")})` : ""}`);
    } else ctx.out(json);
    return 0;
  }
  if (sub === "import") {
    const source = rest[0];
    if (!source) throw new JpeError("INVALID_INPUT", "Usage: jpe config import <file> [--project]");
    const text = await ctx.readText(resolveInside(ctx.cwd, source));
    if (text === undefined) throw new JpeError("INVALID_INPUT", `"${source}" could not be read.`);
    const config = importConfig(text);
    const file = scopeFile(args, ctx);
    const notes = await writeScope(ctx, file, config as unknown as Plain);
    ctx.out([`Imported configuration into ${file}`, ...notes].join("\n"));
    return 0;
  }
  throw new JpeError("INVALID_INPUT", "Usage: jpe config show | path | set <key> <value> | export [--out file] | import <file>");
}

export function store(ctx: CliContext): BackupStore {
  return new BackupStore({ dir: path.join(ctx.stateDir(), "backups"), now: ctx.now, newId: () => `bk-${ctx.now().toISOString().replace(/\D/g, "").slice(0, 14)}-${ctx.newId().slice(0, 6)}` });
}

/** `jpe backup create|seal|rollback|verify|list|prune`. */
export async function backupCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const [sub, ...rest] = args.positionals;
  const backups = store(ctx);
  if (sub === "create") {
    if (rest.length === 0) throw new JpeError("INVALID_INPUT", "Usage: jpe backup create <file...> [--label text]");
    const m = await backups.create(ctx.cwd, rest, flagString(args, "label") ?? "manual backup");
    ctx.out(`Backup ${m.id} created: ${m.files.map((f) => `${f.path}${f.existed ? "" : " (did not exist)"}`).join(", ")}\nAfter the edits, run: jpe backup seal ${m.id}`);
    return 0;
  }
  const id = rest[0];
  if (sub === "seal" && id) {
    await backups.seal(id);
    ctx.out(`Backup ${id} sealed; rollback will now detect later edits by anyone else.`);
    return 0;
  }
  if (sub === "verify" && id) {
    const v = await backups.verify(id);
    ctx.out(v.ok ? `Backup ${id} is intact.` : `Backup ${id} has problems:\n${v.problems.map((p) => `  - ${p}`).join("\n")}`);
    return v.ok ? 0 : 1;
  }
  if (sub === "rollback" && id) {
    const r = await backups.rollback(id, { force: flagBool(args, "force") });
    ctx.out(
      [
        `Rolled back from ${id}.`,
        ...r.restored.map((f) => `  restored ${f}`),
        ...r.removed.map((f) => `  removed ${f} (it did not exist before)`),
        ...r.conflicts.map((f) => `  SKIPPED ${f}: it was changed after the backup was sealed. Review it, or use --force (a safety copy is made first).`),
        ...r.problems.map((p) => `  PROBLEM ${p}`),
        ...(r.safetyBackupId ? [`Safety copy of what was replaced: ${r.safetyBackupId}`] : []),
      ].join("\n"),
    );
    return r.conflicts.length > 0 || r.problems.length > 0 ? 1 : 0;
  }
  if (sub === "list") {
    const all = await backups.list();
    ctx.out(all.length === 0 ? "No backups." : all.map((m) => `${m.id}  ${m.createdAt}  ${m.sealed ? "sealed" : "open"}  ${m.label}  [${m.files.map((f) => f.path).join(", ")}]`).join("\n"));
    return 0;
  }
  if (sub === "prune") {
    const removed = await backups.prune(Number(flagString(args, "keep") ?? "20"));
    ctx.out(`Removed ${removed.length} old backup(s).`);
    return 0;
  }
  throw new JpeError("INVALID_INPUT", "Usage: jpe backup create <files...> | seal <id> | verify <id> | rollback <id> [--force] | list | prune [--keep N]");
}

async function sourceFiles(args: ParsedArgs, ctx: CliContext): Promise<string[]> {
  return args.positionals.length > 0 ? args.positionals : listProjectFiles(ctx.cwd, ctx.git);
}

/** `jpe scan [paths...]`: looks for credentials. Reports rule, file and line only, never the value. */
export async function scanCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const files = await sourceFiles(args, ctx);
  const sensitive: string[] = [];
  const findings: string[] = [];
  for (const f of files.slice(0, 5000)) {
    if (isSensitiveFileName(f)) {
      sensitive.push(f);
      continue;
    }
    const text = await ctx.fs.readText(resolveInside(ctx.cwd, f));
    if (text === undefined) continue;
    for (const hit of scanText(text, f)) findings.push(`${hit.file}:${hit.line} ${hit.rule}`);
  }
  ctx.out([
    findings.length === 0 ? "No credential-shaped text found in the scanned files." : `${findings.length} possible credential(s) (values are never printed):`,
    ...findings.map((l) => `  ${l}`),
    ...(sensitive.length > 0 ? ["", "Files that normally hold credentials (contents not read):", ...sensitive.map((s) => `  ${s}`), "Make sure these are listed in .gitignore."] : []),
  ].join("\n"));
  return findings.length > 0 ? 1 : 0;
}

/** `jpe audit`: bounded static review of the project's source for risky patterns, plus credentials. */
export async function auditCommand(_args: ParsedArgs, ctx: CliContext): Promise<number> {
  const files = (await listProjectFiles(ctx.cwd, ctx.git)).filter((f) => familyOf(f) !== "other" && !isSensitiveFileName(f)).slice(0, 400);
  const rows: Array<{ file: string; line: number; severity: string; message: string }> = [];
  for (const f of files) {
    const text = await ctx.fs.readText(resolveInside(ctx.cwd, f));
    if (text === undefined) continue;
    for (const r of analyzeCode(f, text).risks) if (r.severity !== "low") rows.push({ file: f, line: r.line, severity: r.severity, message: r.message });
  }
  rows.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  ctx.out(
    [
      `Scanned ${files.length} source file(s) for risky patterns (pattern matching: each item is a lead to verify, not a confirmed bug).`,
      rows.length === 0 ? "No high or medium leads found." : `${rows.length} lead(s):`,
      ...rows.slice(0, 80).map((r) => `  [${r.severity}] ${r.file}:${r.line} ${r.message}`),
      ...(rows.length > 80 ? [`  ...and ${rows.length - 80} more`] : []),
    ].join("\n"),
  );
  return 0;
}

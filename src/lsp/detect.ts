import { readdir } from "node:fs/promises";
import path from "node:path";
import { isJpeError } from "../core/errors.js";
import type { GitRunner } from "../project/git.js";
import type { RunOptions, RunResult } from "../security/run.js";
import { languageForFile, type LanguageId, type LanguageSpec } from "./registry.js";

export interface LanguageCount {
  language: LanguageSpec;
  files: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "target", "venv", ".venv", "__pycache__", "vendor", ".next", "coverage", "bin", "obj"]);
const MAX_FILES = 5000;
const MAX_DEPTH = 6;

/** Bounded directory walk used only when the project is not a git repository. */
export async function walkFiles(root: string, limit = MAX_FILES): Promise<string[]> {
  const found: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (found.length >= limit || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) await visit(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        found.push(path.relative(root, path.join(dir, entry.name)));
      }
    }
  }
  await visit(root, 0);
  return found;
}

/** Project files (relative paths): git's own list when available, otherwise a bounded walk. */
export async function listProjectFiles(root: string, git: GitRunner): Promise<string[]> {
  try {
    const out = await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    if (out.exitCode === 0) return out.stdout.split("\0").filter((f) => f !== "").slice(0, MAX_FILES * 4);
  } catch (error) {
    if (!isJpeError(error)) throw error;
  }
  return walkFiles(root);
}

/** Counts files per supported language, most common first. Cheap: no file contents are read. */
export function detectLanguages(files: readonly string[]): LanguageCount[] {
  const counts = new Map<LanguageId, LanguageCount>();
  for (const file of files) {
    const hit = languageForFile(file);
    if (!hit) continue;
    const existing = counts.get(hit.language.id);
    if (existing) existing.files++;
    else counts.set(hit.language.id, { language: hit.language, files: 1 });
  }
  return [...counts.values()].sort((a, b) => b.files - a.files);
}

export interface PathLookup {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  exists: (file: string) => Promise<boolean>;
}

/** Finds an executable on PATH without running anything. Honors PATHEXT on Windows. */
export async function findOnPath(binary: string, lookup: PathLookup): Promise<string | undefined> {
  const win = lookup.platform === "win32";
  const raw = lookup.env["PATH"] ?? lookup.env["Path"] ?? "";
  const dirs = raw.split(win ? ";" : ":").filter((d) => d !== "");
  // On Windows an extensionless file next to "name.cmd" is a Unix shim that cannot be launched,
  // so only PATHEXT variants are candidates unless the caller already gave an extension.
  const exts = win && path.extname(binary) === "" ? (lookup.env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").toLowerCase().split(";").filter(Boolean) : [""];
  const join = win ? path.win32.join : path.posix.join;
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, binary + ext);
      if (await lookup.exists(candidate)) return candidate;
    }
  }
  return undefined;
}

export type ServerState =
  /** Not on PATH. */
  | "missing"
  /** On PATH, but nothing has been run to confirm it works. */
  | "found"
  /** On PATH and its version command ran successfully. */
  | "ready"
  /** On PATH but its version command failed. */
  | "broken";

export interface ServerStatus {
  language: LanguageId;
  binary: string;
  state: ServerState;
  path?: string;
  version?: string;
  detail: string;
}

export interface ServerCheckDeps {
  lookup: PathLookup;
  run: (options: RunOptions) => Promise<RunResult>;
  cwd: string;
  timeoutMs: number;
}

/** Locates a language server and, when it has a version flag, confirms it actually runs. */
export async function checkServer(language: LanguageSpec, deps: ServerCheckDeps): Promise<ServerStatus> {
  const { binary, versionArgs } = language.server;
  const base = { language: language.id, binary };
  const found = await findOnPath(binary, deps.lookup);
  if (!found) return { ...base, state: "missing", detail: `${binary} was not found on your PATH.` };
  if (!versionArgs) return { ...base, state: "found", path: found, detail: `${binary} is on your PATH; it has no version flag, so only a start-up test can confirm it works.` };
  try {
    const result = await deps.run({ file: found, args: versionArgs, cwd: deps.cwd, timeoutMs: deps.timeoutMs });
    if (result.exitCode !== 0 || result.timedOut) {
      return { ...base, state: "broken", path: found, detail: `${binary} was found but its version command failed (exit ${result.exitCode}).` };
    }
    const version = (result.stdout || result.stderr).split(/\r?\n/)[0]?.trim() ?? "";
    return { ...base, state: "ready", path: found, ...(version ? { version } : {}), detail: `${binary} runs${version ? `: ${version}` : ""}.` };
  } catch (error) {
    if (isJpeError(error)) return { ...base, state: "broken", path: found, detail: error.userMessage };
    throw error;
  }
}

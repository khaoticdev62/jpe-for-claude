/**
 * What JPE stores on disk, and the safe removal of parts of it.
 *
 * JPE keeps everything in one data folder: its settings file, a documentation cache, and one folder of records per project
 * (tasks, review decisions, agent activity, the event log, verification evidence, session records) with that project's
 * file backups in a subfolder. Nothing is stored in your project except `.jpe/config.json`, which is yours and is never
 * touched here.
 *
 * Removal is deliberately narrow: only names JPE itself creates, only inside the data folder, symlinks are removed as
 * links and never followed, and "everything" is an allow-list of names, never "whatever is in the folder".
 */

import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

export interface DirStats {
  files: number;
  bytes: number;
  /** The most recent modification time, in milliseconds since 1970; 0 when empty. */
  newestMs: number;
  /** True when the walk stopped early because the folder held too many entries; the numbers are then lower bounds. */
  truncated: boolean;
}

const MAX_ENTRIES = 20_000;
const EMPTY: DirStats = { files: 0, bytes: 0, newestMs: 0, truncated: false };

/** Counts files and bytes under a path (a file counts as one). Symlinks are counted, never followed. A missing path is empty. */
export async function pathStats(target: string, limit = MAX_ENTRIES): Promise<DirStats> {
  let files = 0;
  let bytes = 0;
  let newestMs = 0;
  let seen = 0;
  let truncated = false;
  const walk = async (current: string): Promise<void> => {
    if (truncated) return;
    const info = await lstat(current).catch(() => undefined);
    if (info === undefined) return;
    if (++seen > limit) {
      truncated = true;
      return;
    }
    newestMs = Math.max(newestMs, info.mtimeMs);
    if (!info.isDirectory()) {
      files += 1;
      bytes += info.size;
      return;
    }
    for (const name of await readdir(current).catch(() => [] as string[])) await walk(path.join(current, name));
  };
  await walk(target);
  return files === 0 && !truncated ? { ...EMPTY } : { files, bytes, newestMs: Math.round(newestMs), truncated };
}

const add = (a: DirStats, b: DirStats): DirStats => ({ files: a.files + b.files, bytes: a.bytes + b.bytes, newestMs: Math.max(a.newestMs, b.newestMs), truncated: a.truncated || b.truncated });

export const BACKUPS_DIR = "backups";
export const SETTINGS_FILE = "config.json";
export const CACHE_DIR = "docs-cache";
export const PROJECTS_DIR = "projects";
export const VERSION_FILE = "version.json";

export interface ProjectUse {
  key: string;
  /** True for the project the command was run in. */
  current: boolean;
  /** Everything except backups: tasks, decisions, agent activity, the log, verification evidence, sessions. */
  records: DirStats;
  backups: DirStats;
}

export interface Inventory {
  root: string;
  settings: DirStats;
  docsCache: DirStats;
  other: DirStats;
  projects: ProjectUse[];
  total: DirStats;
}

const isSettingsName = (name: string): boolean => name === SETTINGS_FILE || name.startsWith(`${SETTINGS_FILE}.bak-`);

/** Everything JPE keeps in its data folder, grouped by what it is. Read-only. */
export async function scanInventory(root: string, currentKey: string): Promise<Inventory> {
  const names = await readdir(root).catch(() => [] as string[]);
  let settings = { ...EMPTY };
  let other = { ...EMPTY };
  for (const name of names) {
    if (name === CACHE_DIR || name === PROJECTS_DIR) continue;
    const stats = await pathStats(path.join(root, name));
    if (isSettingsName(name)) settings = add(settings, stats);
    else other = add(other, stats);
  }
  const docsCache = await pathStats(path.join(root, CACHE_DIR));
  const projects: ProjectUse[] = [];
  const projectsDir = path.join(root, PROJECTS_DIR);
  for (const key of (await readdir(projectsDir).catch(() => [] as string[])).sort()) {
    const dir = path.join(projectsDir, key);
    const all = await pathStats(dir);
    const backups = await pathStats(path.join(dir, BACKUPS_DIR));
    projects.push({ key, current: key === currentKey, records: { ...all, files: all.files - backups.files, bytes: all.bytes - backups.bytes }, backups });
  }
  const total = projects.reduce((sum, p) => add(add(sum, p.records), p.backups), add(add(settings, docsCache), other));
  return { root, settings, docsCache, other, projects, total };
}

export const REMOVAL_SCOPES = ["cache", "records", "backups", "all"] as const;
export type RemovalScope = (typeof REMOVAL_SCOPES)[number];

export interface RemovalPlan {
  scope: RemovalScope;
  /** Absolute paths that would be removed, each one inside the data folder. */
  targets: string[];
  /** What the person loses, in plain words. */
  consequences: string[];
  stats: DirStats;
}

/** True when `target` is strictly inside `root` (never the root itself). */
export function isStrictlyInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Works out exactly what a removal would delete, without deleting anything. */
export async function planRemoval(scope: RemovalScope, root: string, projectDir: string): Promise<RemovalPlan> {
  let targets: string[];
  let consequences: string[];
  switch (scope) {
    case "cache":
      targets = [path.join(root, CACHE_DIR)];
      consequences = ["Cached documentation is removed. It is downloaded again the next time it is needed (offline mode will have nothing cached until then)."];
      break;
    case "records":
      targets = (await readdir(projectDir).catch(() => [] as string[])).filter((n) => n !== BACKUPS_DIR).map((n) => path.join(projectDir, n));
      consequences = ["This project's tasks, review decisions, agent activity, event log, verification record and session records are removed.", "File backups for this project are kept."];
      break;
    case "backups":
      targets = [path.join(projectDir, BACKUPS_DIR)];
      consequences = ["This project's file backups are removed, so `jpe backup rollback` can no longer restore files Claude edited. This cannot be undone."];
      break;
    case "all": {
      const names = await readdir(root).catch(() => [] as string[]);
      targets = names.filter((n) => n === CACHE_DIR || n === PROJECTS_DIR || n === VERSION_FILE || isSettingsName(n)).map((n) => path.join(root, n));
      consequences = ["Your settings, the documentation cache, and the records AND file backups of EVERY project are removed. This cannot be undone.", "Your project folders and any `.jpe/config.json` inside them are not touched."];
      break;
    }
  }
  const safe = targets.filter((t) => isStrictlyInside(root, t));
  let stats = { ...EMPTY };
  for (const t of safe) stats = add(stats, await pathStats(t));
  return { scope, targets: safe, consequences, stats };
}

export interface RemovalResult {
  removed: string[];
  failed: Array<{ target: string; reason: string }>;
}

/** Removes what a plan lists. Each target is re-checked to be inside the data folder; a symlink is removed as a link. */
export async function executeRemoval(plan: RemovalPlan, root: string): Promise<RemovalResult> {
  const result: RemovalResult = { removed: [], failed: [] };
  for (const target of plan.targets) {
    if (!isStrictlyInside(root, target)) {
      result.failed.push({ target, reason: "it is outside JPE's data folder" });
      continue;
    }
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      result.removed.push(target);
    } catch (error) {
      result.failed.push({ target, reason: error instanceof Error ? error.message : "it could not be removed" });
    }
  }
  return result;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

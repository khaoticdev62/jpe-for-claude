import { isJpeError } from "../core/errors.js";
import { runCommand } from "../security/run.js";

export interface GitOutput {
  exitCode: number;
  stdout: string;
}

/** Runs `git <args>` in the project. Injected so parsing can be tested without a repository. */
export type GitRunner = (args: readonly string[]) => Promise<GitOutput>;

export interface ChangedFile {
  path: string;
  /** Two-letter porcelain status, e.g. " M", "??", "A ". */
  status: string;
}

export interface GitState {
  /** False when git is not installed. */
  available: boolean;
  isRepo: boolean;
  branch?: string;
  dirty: boolean;
  changedFiles: ChangedFile[];
  truncated: boolean;
}

const MAX_CHANGED_FILES = 200;

export function createGitRunner(root: string, timeoutMs = 15_000): GitRunner {
  return async (args) => {
    const result = await runCommand({ file: "git", args, cwd: root, timeoutMs });
    return { exitCode: result.exitCode, stdout: result.stdout };
  };
}

/** Parses `git status --porcelain=v1 -z` output (NUL separated; renames carry an extra path). */
export function parsePorcelain(output: string): ChangedFile[] {
  const parts = output.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    files.push({ status, path: entry.slice(3) });
    if (status.includes("R") || status.includes("C")) i++; // skip the original path
  }
  return files;
}

/** Read-only snapshot of the working tree, taken before JPE changes anything. */
export async function readGitState(git: GitRunner): Promise<GitState> {
  const none: GitState = { available: true, isRepo: false, dirty: false, changedFiles: [], truncated: false };
  try {
    const inside = await git(["rev-parse", "--is-inside-work-tree"]);
    if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return none;
    const branchResult = await git(["symbolic-ref", "--short", "-q", "HEAD"]);
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : "(detached HEAD)";
    const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const all = status.exitCode === 0 ? parsePorcelain(status.stdout) : [];
    return {
      available: true,
      isRepo: true,
      branch,
      dirty: all.length > 0,
      changedFiles: all.slice(0, MAX_CHANGED_FILES),
      truncated: all.length > MAX_CHANGED_FILES,
    };
  } catch (error) {
    if (isJpeError(error) && error.code === "TOOL_UNAVAILABLE") return { ...none, available: false };
    throw error;
  }
}

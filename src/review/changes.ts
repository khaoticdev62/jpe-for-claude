import { createHash } from "node:crypto";
import path from "node:path";
import type { CliContext } from "../cli/context.js";
import { JpeError } from "../core/errors.js";
import { type ChangedFile, readGitState } from "../project/git.js";

export interface Changes {
  /** The repository's top folder; changed paths are relative to it. */
  root: string;
  files: ChangedFile[];
  /** True when git reported more changed files than it listed. */
  truncated: boolean;
}

/** The uncommitted changes, from git. Throws a plain-English error when there is no git or no repository. */
export async function listChanges(ctx: Pick<CliContext, "git" | "cwd">): Promise<Changes> {
  const state = await readGitState(ctx.git);
  if (!state.available) throw new JpeError("TOOL_UNAVAILABLE", "Git is not installed, so there is nothing to compare against.");
  if (!state.isRepo) throw new JpeError("INVALID_INPUT", "This folder is not a git repository, so there is no committed version to compare against.");
  const top = await ctx.git(["rev-parse", "--show-toplevel"]);
  const root = top.exitCode === 0 && top.stdout.trim() !== "" ? top.stdout.trim() : ctx.cwd;
  return { root, files: state.changedFiles, truncated: state.truncated };
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export interface ReviewFingerprint {
  /** A hash of exactly what is changed: every changed path, its git status, and the hash of its current content. */
  fingerprint: string;
  fileCount: number;
}

/**
 * Identifies the current set of uncommitted changes by content, so a decision about them can tell whether the files have
 * changed since. Reads each changed file (files over the reader's limit or unreadable as text count as empty, which is
 * stable). Never changes anything.
 */
export async function reviewFingerprint(ctx: Pick<CliContext, "git" | "cwd" | "fs">): Promise<ReviewFingerprint> {
  const { root, files } = await listChanges(ctx);
  const lines: string[] = [];
  for (const file of files) {
    const content = file.status.includes("D") ? "" : ((await ctx.fs.readText(path.resolve(root, file.path))) ?? "");
    lines.push(`${file.status}\t${file.path}\t${sha256(content)}`);
  }
  lines.sort();
  return { fingerprint: sha256(lines.join("\n")), fileCount: files.length };
}

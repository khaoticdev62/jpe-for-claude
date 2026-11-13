import { realpath } from "node:fs/promises";
import path from "node:path";
import { JpeError } from "../core/errors.js";

function reject(message: string): never {
  throw new JpeError("PATH_REJECTED", message);
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false; // different drive on Windows
  return rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

/**
 * Lexical containment check: resolves `candidate` against `root` and refuses anything that
 * lands outside it (../ traversal, absolute paths elsewhere, null bytes). Does not touch the disk.
 */
export function resolveInside(root: string, candidate: string): string {
  if (candidate.includes("\0") || root.includes("\0")) reject("The path contains an invalid character.");
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, candidate);
  if (!isInside(absRoot, abs)) reject("That path points outside the project folder, so JPE will not touch it.");
  return abs;
}

/**
 * Containment check that also follows symlinks. The deepest existing ancestor of the target is
 * resolved on disk, so a symlink inside the project that points elsewhere is rejected.
 */
export async function resolveInsideReal(root: string, candidate: string): Promise<string> {
  const abs = resolveInside(root, candidate);
  const realRoot = await realpath(path.resolve(root));
  let existing = abs;
  for (;;) {
    try {
      const realExisting = await realpath(existing);
      const full = path.join(realExisting, path.relative(existing, abs));
      if (!isInside(realRoot, full)) reject("That path resolves outside the project folder through a link, so JPE will not touch it.");
      return full;
    } catch (error) {
      if (error instanceof JpeError) throw error;
      const parent = path.dirname(existing);
      if (parent === existing) reject("The path could not be resolved.");
      existing = parent;
    }
  }
}

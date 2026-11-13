import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Read-only file access used by project analysis. Injected so tests never need a real disk. */
export interface ProjectFs {
  /** File text, or undefined when the file does not exist. Other failures throw. */
  readText(file: string): Promise<string | undefined>;
  exists(file: string): Promise<boolean>;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function isMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export const nodeProjectFs: ProjectFs = {
  async readText(file) {
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined;
      return await readFile(file, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  },
  async exists(file) {
    try {
      await stat(file);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  },
};

export function inRoot(root: string, ...parts: string[]): string {
  return path.join(root, ...parts);
}

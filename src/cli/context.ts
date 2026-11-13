import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { dataDir, type PathEnv } from "../config/paths.js";
import type { JpeConfig } from "../config/schema.js";
import { defaultNetDeps, type NetDeps } from "../docs/net.js";
import { nodeProjectFs, type ProjectFs } from "../project/fs.js";
import { createGitRunner, type GitRunner } from "../project/git.js";
import { runCommand } from "../security/run.js";

/** Everything a command needs from the outside world, injected so commands are testable. */
export interface CliContext {
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  readStdin: () => Promise<string>;
  pathEnv: PathEnv;
  fs: ProjectFs;
  git: GitRunner;
  run: typeof runCommand;
  net: NetDeps;
  now: () => Date;
  newId: () => string;
  /** Effective configuration (defaults < global < project < environment). */
  loadConfig: () => Promise<JpeConfig>;
  /** Folder for this project's runs, baselines and backups. */
  stateDir: () => string;
  /** Atomic text write that creates parent folders. */
  writeText: (file: string, text: string) => Promise<void>;
  readText: (file: string) => Promise<string | undefined>;
}

async function readStdinAll(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

export async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, text, "utf8");
  await rename(temp, file);
}

export function projectKey(root: string): string {
  return createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 12);
}

export function createContext(overrides: Partial<CliContext> = {}): CliContext {
  const cwd = overrides.cwd ?? process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
  const pathEnv: PathEnv = overrides.pathEnv ?? { platform: process.platform, env: process.env, homedir: os.homedir() };
  const fs = overrides.fs ?? nodeProjectFs;
  const ctx: CliContext = {
    cwd,
    out: (t) => void process.stdout.write(t.endsWith("\n") ? t : `${t}\n`),
    err: (t) => void process.stderr.write(t.endsWith("\n") ? t : `${t}\n`),
    readStdin: readStdinAll,
    pathEnv,
    fs,
    git: createGitRunner(cwd),
    run: runCommand,
    net: defaultNetDeps(),
    now: () => new Date(),
    newId: () => randomUUID().replaceAll("-", "").slice(0, 16),
    loadConfig: () => loadConfig({ fs: { readText: (p) => fs.readText(p) }, pathEnv, projectRoot: cwd }),
    stateDir: () => path.join(dataDir(pathEnv), "projects", projectKey(cwd)),
    writeText: writeAtomic,
    readText: async (file) => {
      try {
        return await readFile(file, "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return undefined;
        throw error;
      }
    },
    ...overrides,
  };
  return ctx;
}

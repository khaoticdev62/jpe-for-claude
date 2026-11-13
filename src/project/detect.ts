import { z } from "zod";
import { inRoot, type ProjectFs } from "./fs.js";

export type Ecosystem = "node" | "python" | "go" | "rust";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
/** installed = read from the installed package; lockfile = pinned by a lockfile; declared = a manifest range only. */
export type VersionSource = "installed" | "lockfile" | "declared";

export interface Dependency {
  name: string;
  ecosystem: Ecosystem;
  /** The range or constraint written in the manifest, when known. */
  declared?: string;
  /** The exact version, when known. Absent means only the declared range is available. */
  version?: string;
  versionSource: VersionSource;
  dev: boolean;
}

export interface ProjectInfo {
  root: string;
  ecosystems: Ecosystem[];
  packageManager?: PackageManager;
  hasLockfile: boolean;
  scripts: Record<string, string>;
  dependencies: Dependency[];
  /** Project instruction files Claude should respect (CLAUDE.md, AGENTS.md). */
  instructionFiles: string[];
  /** Problems found while reading manifests; analysis continues past them. */
  warnings: string[];
}

export const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

const stringRecord = z.record(z.string(), z.string());
const packageJsonSchema = z.looseObject({
  scripts: stringRecord.optional(),
  dependencies: stringRecord.optional(),
  devDependencies: stringRecord.optional(),
  packageManager: z.string().optional(),
});
const lockSchema = z.looseObject({ packages: z.record(z.string(), z.looseObject({ version: z.string().optional() })).optional() });
const versionOnly = z.looseObject({ version: z.string() });

const NODE_LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function detectNode(root: string, fs: ProjectFs, info: ProjectInfo): Promise<void> {
  const text = await fs.readText(inRoot(root, "package.json"));
  if (text === undefined) return;
  info.ecosystems.push("node");
  const parsed = packageJsonSchema.safeParse(tryJson(text));
  if (!parsed.success) {
    info.warnings.push("package.json is not valid JSON or has an unexpected shape; dependency details were skipped.");
    return;
  }
  const pkg = parsed.data;
  info.scripts = pkg.scripts ?? {};

  for (const [file, manager] of NODE_LOCKFILES) {
    if (await fs.exists(inRoot(root, file))) {
      info.packageManager = manager;
      info.hasLockfile = true;
      break;
    }
  }
  if (!info.packageManager) {
    const declared = pkg.packageManager?.split("@")[0];
    info.packageManager = declared === "pnpm" || declared === "yarn" || declared === "bun" ? declared : "npm";
  }

  const lockText = await fs.readText(inRoot(root, "package-lock.json"));
  const lock = lockText === undefined ? undefined : lockSchema.safeParse(tryJson(lockText));
  const lockPackages = lock?.success ? lock.data.packages : undefined;

  const groups: ReadonlyArray<readonly [Record<string, string>, boolean]> = [
    [pkg.dependencies ?? {}, false],
    [pkg.devDependencies ?? {}, true],
  ];
  for (const [deps, dev] of groups) {
    for (const [name, declared] of Object.entries(deps)) {
      if (!NPM_NAME.test(name)) {
        info.warnings.push(`Skipped dependency with an unusual name: ${name.slice(0, 60)}`);
        continue;
      }
      const dep: Dependency = { name, ecosystem: "node", declared, versionSource: "declared", dev };
      const installedText = await fs.readText(inRoot(root, "node_modules", name, "package.json"));
      const installed = installedText === undefined ? undefined : versionOnly.safeParse(tryJson(installedText));
      const locked = lockPackages?.[`node_modules/${name}`]?.version;
      if (installed?.success) {
        dep.version = installed.data.version;
        dep.versionSource = "installed";
      } else if (locked) {
        dep.version = locked;
        dep.versionSource = "lockfile";
      }
      info.dependencies.push(dep);
    }
  }
}

async function detectRust(root: string, fs: ProjectFs, info: ProjectInfo): Promise<void> {
  const manifest = await fs.readText(inRoot(root, "Cargo.toml"));
  if (manifest === undefined) return;
  info.ecosystems.push("rust");
  const lock = (await fs.readText(inRoot(root, "Cargo.lock"))) ?? "";
  const locked = new Map<string, string>();
  for (const m of lock.matchAll(/\[\[package\]\]\s*name\s*=\s*"([^"]+)"\s*version\s*=\s*"([^"]+)"/g)) {
    if (m[1] && m[2]) locked.set(m[1], m[2]);
  }
  let section = "";
  for (const raw of manifest.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header?.[1]) {
      section = header[1];
      continue;
    }
    if (section !== "dependencies" && section !== "dev-dependencies") continue;
    const dep = /^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/.exec(line);
    if (!dep?.[1]) continue;
    const version = locked.get(dep[1]);
    info.dependencies.push({
      name: dep[1],
      ecosystem: "rust",
      declared: dep[2] ?? dep[3] ?? "",
      ...(version ? { version, versionSource: "lockfile" as const } : { versionSource: "declared" as const }),
      dev: section === "dev-dependencies",
    });
  }
  if (lock !== "") info.hasLockfile = true;
}

async function detectGo(root: string, fs: ProjectFs, info: ProjectInfo): Promise<void> {
  const mod = await fs.readText(inRoot(root, "go.mod"));
  if (mod === undefined) return;
  info.ecosystems.push("go");
  info.hasLockfile = true; // go.mod pins exact module versions
  for (const m of mod.matchAll(/^\s*(?:require\s+)?([A-Za-z0-9._~/-]+\.[A-Za-z0-9._~/-]+)\s+(v[0-9][^\s]*)/gm)) {
    if (m[1] && m[2]) info.dependencies.push({ name: m[1], ecosystem: "go", declared: m[2], version: m[2], versionSource: "lockfile", dev: false });
  }
}

async function detectPython(root: string, fs: ProjectFs, info: ProjectInfo): Promise<void> {
  const requirements = await fs.readText(inRoot(root, "requirements.txt"));
  const hasPyproject = await fs.exists(inRoot(root, "pyproject.toml"));
  if (requirements === undefined && !hasPyproject) return;
  info.ecosystems.push("python");
  for (const raw of (requirements ?? "").split(/\r?\n/)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(==|>=|<=|~=|>|<|!=)\s*([A-Za-z0-9.*+!_-]+)/.exec(raw.trim());
    if (!m?.[1] || !m[2] || !m[3]) continue;
    const pinned = m[2] === "==";
    info.dependencies.push({
      name: m[1],
      ecosystem: "python",
      declared: `${m[2]}${m[3]}`,
      ...(pinned ? { version: m[3] } : {}),
      versionSource: "declared",
      dev: false,
    });
  }
}

const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md"] as const;

/** Reads manifests and lockfiles (no process execution, no full-tree scan) to describe the project. */
export async function detectProject(root: string, fs: ProjectFs): Promise<ProjectInfo> {
  const info: ProjectInfo = {
    root,
    ecosystems: [],
    hasLockfile: false,
    scripts: {},
    dependencies: [],
    instructionFiles: [],
    warnings: [],
  };
  await detectNode(root, fs, info);
  await detectRust(root, fs, info);
  await detectGo(root, fs, info);
  await detectPython(root, fs, info);
  for (const file of INSTRUCTION_FILES) if (await fs.exists(inRoot(root, file))) info.instructionFiles.push(file);
  return info;
}

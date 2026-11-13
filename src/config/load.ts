import { JpeError } from "../core/errors.js";
import { defaultConfig } from "./defaults.js";
import { migrateConfig } from "./migrate.js";
import { globalConfigPath, projectConfigPath, type PathEnv } from "./paths.js";
import { configSchema, partialConfigSchema, type JpeConfig } from "./schema.js";

export interface ConfigFs {
  /** Returns file text, or undefined when the file does not exist. Other failures throw. */
  readText(path: string): Promise<string | undefined>;
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merges plain objects; arrays and scalars from `over` replace those in `base`. */
export function deepMerge(base: Plain, over: Plain): Plain {
  const out: Plain = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const existing = out[key];
    out[key] = isPlain(existing) && isPlain(value) ? deepMerge(existing, value) : value;
  }
  return out;
}

function describeIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ");
}

async function readLayer(fs: ConfigFs, file: string, label: string): Promise<Plain | undefined> {
  const text = await fs.readText(file);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new JpeError("INVALID_CONFIG", `The ${label} configuration (${file}) is not valid JSON.`, { cause });
  }
  const migrated = migrateConfig(parsed);
  const checked = partialConfigSchema.safeParse(migrated);
  if (!checked.success) {
    throw new JpeError("INVALID_CONFIG", `The ${label} configuration (${file}) is invalid: ${describeIssues(checked.error.issues)}`);
  }
  return migrated;
}

/** Environment overrides. Only an explicit allow-list is honored. */
export function envOverrides(env: Record<string, string | undefined>): Plain {
  const runtime: Plain = {};
  const offline = env["JPE_OFFLINE"];
  if (offline === "1" || offline === "true") runtime["offline"] = true;
  else if (offline === "0" || offline === "false") runtime["offline"] = false;
  const level = env["JPE_LOG_LEVEL"];
  if (level !== undefined) runtime["logLevel"] = level;
  return Object.keys(runtime).length > 0 ? { runtime } : {};
}

export interface LoadOptions {
  fs: ConfigFs;
  pathEnv: PathEnv;
  projectRoot?: string;
}

/** Precedence (lowest to highest): defaults < global file < project file < environment. */
export async function loadConfig(opts: LoadOptions): Promise<JpeConfig> {
  let merged: Plain = defaultConfig();
  const globalLayer = await readLayer(opts.fs, globalConfigPath(opts.pathEnv), "global");
  if (globalLayer) merged = deepMerge(merged, globalLayer);
  if (opts.projectRoot) {
    const projectLayer = await readLayer(opts.fs, projectConfigPath(opts.projectRoot), "project");
    if (projectLayer) merged = deepMerge(merged, projectLayer);
  }
  merged = deepMerge(merged, envOverrides(opts.pathEnv.env));
  const final = configSchema.safeParse(merged);
  if (!final.success) {
    throw new JpeError("INVALID_CONFIG", `The effective JPE configuration is invalid: ${describeIssues(final.error.issues)}`);
  }
  return final.data;
}

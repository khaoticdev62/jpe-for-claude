import { JpeError } from "../core/errors.js";
import { defaultConfig } from "./defaults.js";
import { deepMerge } from "./load.js";
import { migrateConfig } from "./migrate.js";
import { configSchema, type JpeConfig } from "./schema.js";

const SECRET_KEY = /(api[_-]?key|secret|token|password|passwd)$|^credentials?$/i;
const URL_WITH_CREDENTIALS = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*:[^/\s]*@/i;

function scrub(value: unknown, removed: string[], trail: string): unknown {
  if (Array.isArray(value)) return value.map((v, i) => scrub(v, removed, `${trail}[${i}]`));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) {
        removed.push(`${trail}.${k}`);
        continue;
      }
      out[k] = scrub(v, removed, `${trail}.${k}`);
    }
    return out;
  }
  if (typeof value === "string" && URL_WITH_CREDENTIALS.test(value)) {
    removed.push(trail);
    return "";
  }
  return value;
}

export interface ExportResult {
  json: string;
  /** Paths stripped because they looked like secrets. Empty for a normal config. */
  removed: string[];
}

/** Serializes the config for sharing. Secret-looking keys and credentialed URLs are never exported. */
export function exportConfig(config: JpeConfig): ExportResult {
  const removed: string[] = [];
  const safe = scrub(config, removed, "$");
  return { json: `${JSON.stringify(safe, null, 2)}\n`, removed };
}

/** Parses, migrates, and validates an exported config. Returns a complete config. */
export function importConfig(text: string): JpeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new JpeError("INVALID_INPUT", "The import file is not valid JSON.", { cause });
  }
  const migrated = migrateConfig(parsed);
  const removed: string[] = [];
  scrub(migrated, removed, "$");
  if (removed.length > 0) {
    throw new JpeError("INVALID_INPUT", `The import contains secret-looking values (${removed.join(", ")}). Remove them and try again.`);
  }
  const result = configSchema.safeParse(deepMerge(defaultConfig(), migrated));
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ");
    throw new JpeError("INVALID_INPUT", `The import is not a valid JPE configuration: ${detail}`);
  }
  return result.data;
}

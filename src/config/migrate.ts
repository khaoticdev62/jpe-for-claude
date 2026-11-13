import { JpeError } from "../core/errors.js";
import { CONFIG_SCHEMA_VERSION } from "./schema.js";

type RawConfig = Record<string, unknown>;

/** Each entry upgrades a config from version N to N+1. Add new entries; never edit old ones. */
const MIGRATIONS: Readonly<Record<number, (raw: RawConfig) => RawConfig>> = {
  // v0 (no schemaVersion field) -> v1: the flat `offline` flag moved under `runtime`.
  0: (raw) => {
    const { offline, ...rest } = raw;
    if (typeof offline !== "boolean") return { ...rest, schemaVersion: 1 };
    const existing = rest["runtime"];
    const runtime = typeof existing === "object" && existing !== null ? (existing as RawConfig) : {};
    return { ...rest, runtime: { ...runtime, offline }, schemaVersion: 1 };
  },
};

export function migrateConfig(input: unknown): RawConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new JpeError("INVALID_CONFIG", "The JPE configuration must be a JSON object.");
  }
  let current = input as RawConfig;
  const startVersion = current["schemaVersion"] ?? 0;
  if (typeof startVersion !== "number" || !Number.isInteger(startVersion) || startVersion < 0) {
    throw new JpeError("INVALID_CONFIG", "The configuration has an invalid schemaVersion.");
  }
  if (startVersion > CONFIG_SCHEMA_VERSION) {
    throw new JpeError(
      "INVALID_CONFIG",
      `This configuration was written by a newer JPE (schema ${startVersion}); this version understands up to ${CONFIG_SCHEMA_VERSION}.`,
    );
  }
  for (let v = startVersion; v < CONFIG_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new JpeError("INTERNAL", `Missing configuration migration from version ${v}.`);
    current = step(current);
  }
  return current;
}

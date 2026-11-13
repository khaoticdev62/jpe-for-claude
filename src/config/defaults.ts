import { configSchema, type JpeConfig } from "./schema.js";

/** Defaults are derived from the schema so there is exactly one source of truth. */
export function defaultConfig(): JpeConfig {
  return configSchema.parse({});
}

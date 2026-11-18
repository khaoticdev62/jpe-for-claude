import { readdir } from "node:fs/promises";
import path from "node:path";
import { effectiveValue, settingSources } from "../../config/catalog.js";
import { envOverrides } from "../../config/load.js";
import { migrateConfig } from "../../config/migrate.js";
import { dataDir, globalConfigPath, projectConfigPath } from "../../config/paths.js";
import { JpeError } from "../../core/errors.js";
import { LOG_LEVELS, type LogLevel, recentEntries } from "../../obs/log.js";
import { loadLog } from "../../obs/store.js";
import { logView, offlineView, type OfflineFacts } from "../../obs/views.js";
import { paint } from "../../ui/paint.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { PROVIDERS } from "./research.js";
import { renderContext } from "./render-profile.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 500;

type Plain = Record<string, unknown>;

async function readLayer(ctx: CliContext, file: string): Promise<Plain | undefined> {
  const text = await ctx.readText(file);
  if (text === undefined) return undefined;
  try {
    return migrateConfig(JSON.parse(text)) as Plain;
  } catch {
    return undefined;
  }
}

/** `jpe offline [--json]`: whether offline mode is on, who set it, which sources it affects, and what is cached. Read-only. */
export async function offlineCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const config = await ctx.loadConfig();
  const sources = settingSources({ global: await readLayer(ctx, globalConfigPath(ctx.pathEnv)), project: await readLayer(ctx, projectConfigPath(ctx.cwd)), environment: envOverrides(ctx.pathEnv.env) });
  const cached = (await readdir(path.join(dataDir(ctx.pathEnv), "docs-cache")).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).length;
  const facts: OfflineFacts = {
    offline: effectiveValue(config, "runtime.offline") === true,
    source: sources["runtime.offline"] ?? "default",
    cachedDocs: cached,
    providers: Object.values(PROVIDERS).map((p) => ({ name: p.name, needsNetwork: p.needsNetwork })),
  };
  if (flagBool(args, "json")) {
    ctx.out(JSON.stringify(facts, null, 2));
    return 0;
  }
  const { profile } = await renderContext(args, ctx);
  ctx.out(paint(offlineView(facts, profile), profile));
  return 0;
}

/** `jpe log [--level debug|info|warn|error] [--limit n] [--json]`: JPE's own recent events, newest first. Read-only. */
export async function logCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const rawLevel = flagString(args, "level") ?? "info";
  if (!(LOG_LEVELS as readonly string[]).includes(rawLevel)) throw new JpeError("INVALID_INPUT", `"${rawLevel}" is not a log level. Use one of: ${LOG_LEVELS.join(", ")}.`);
  const level = rawLevel as LogLevel;
  const rawLimit = flagString(args, "limit");
  const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new JpeError("INVALID_INPUT", `--limit must be a whole number from 1 to ${MAX_LIMIT}.`);
  const all = await loadLog(ctx);
  const entries = recentEntries(all, level, limit);
  if (flagBool(args, "json")) {
    ctx.out(JSON.stringify(entries, null, 2));
    return 0;
  }
  // The log is what you read when something is wrong, so a damaged settings file must not stop it from opening.
  const loaded = await ctx.loadConfig().then((config) => ({ config }), (error: unknown) => ({ problem: error instanceof JpeError ? error.userMessage : "the settings could not be read" }));
  const configured = "config" in loaded ? loaded.config.runtime.logLevel : "info";
  const { profile } = await renderContext(args, ctx, { defaultsIfSettingsUnreadable: true });
  ctx.out(paint(logView(entries, ctx.now(), level, configured, all.length, profile, "problem" in loaded ? loaded.problem : undefined), profile));
  return 0;
}

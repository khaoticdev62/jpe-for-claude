import path from "node:path";
import { dataDir, globalConfigPath, projectConfigPath } from "../../config/paths.js";
import { JpeError, isJpeError } from "../../core/errors.js";
import { safeRequest } from "../../docs/net.js";
import { executeRemoval, planRemoval, REMOVAL_SCOPES, type RemovalScope, scanInventory } from "../../lifecycle/inventory.js";
import { aboutView, type AboutFacts, type CheckOutcome, dataView, removalView } from "../../lifecycle/views.js";
import { checkAgainstManifest, LATEST_MANIFEST_HOST, LATEST_MANIFEST_URL, PACKAGE_VERSION } from "../../lifecycle/version.js";
import { paint } from "../../ui/paint.js";
import { flagBool, type ParsedArgs } from "../args.js";
import { projectKey, type CliContext } from "../context.js";
import { renderContext } from "./render-profile.js";

const CHECK_TIMEOUT_MS = 10_000;

async function readJsonField(ctx: CliContext, file: string, field: string): Promise<string | undefined> {
  const text = await ctx.readText(file).catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const value = (JSON.parse(text) as Record<string, unknown>)[field];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Asks GitHub for the published manifest. Respects offline mode, sends nothing about you or your project, never throws. */
async function checkForUpdate(ctx: CliContext, offline: boolean): Promise<CheckOutcome> {
  if (offline) return { state: "skipped", reason: "Offline mode is on, so JPE made no network request. Turn it off with `jpe config set runtime.offline false`." };
  try {
    const response = await safeRequest({ url: LATEST_MANIFEST_URL, accept: "application/json", allowedHosts: [LATEST_MANIFEST_HOST], timeoutMs: CHECK_TIMEOUT_MS, maxBytes: 64 * 1024 }, ctx.net);
    return checkAgainstManifest(PACKAGE_VERSION, response.text);
  } catch (error) {
    return { state: "unknown", installed: PACKAGE_VERSION, reason: isJpeError(error) ? error.userMessage : "the request failed" };
  }
}

/**
 * `jpe about [--check] [--json]`
 *
 * The version that is running, where the plugin and its data live, and how to update or uninstall through Claude Code.
 * With `--check`, asks GitHub whether a newer version is published (one plain request; offline mode refuses it).
 */
export async function aboutCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const root = ctx.pluginRoot;
  const manifestVersion = root === undefined ? undefined : await readJsonField(ctx, path.join(root, ".claude-plugin", "plugin.json"), "version");
  const marketplace = root === undefined ? undefined : await readJsonField(ctx, path.join(root, ".claude-plugin", "marketplace.json"), "name");
  const pluginName = root === undefined ? undefined : await readJsonField(ctx, path.join(root, ".claude-plugin", "plugin.json"), "name");
  const globalSettings = globalConfigPath(ctx.pathEnv);
  const projectSettings = projectConfigPath(ctx.cwd);
  const config = await ctx.loadConfig().catch(() => undefined);
  const facts: AboutFacts = {
    version: PACKAGE_VERSION,
    ...(manifestVersion === undefined ? {} : { manifestVersion }),
    ...(root === undefined ? {} : { pluginRoot: root }),
    dataRoot: dataDir(ctx.pathEnv),
    settingsFiles: [
      { label: "Your settings", path: globalSettings, exists: (await ctx.readText(globalSettings).catch(() => undefined)) !== undefined },
      { label: "Project settings", path: projectSettings, exists: (await ctx.readText(projectSettings).catch(() => undefined)) !== undefined },
    ],
    ...(pluginName !== undefined && marketplace !== undefined ? { pluginId: `${pluginName}@${marketplace}` } : {}),
    ...(flagBool(args, "check") ? { check: await checkForUpdate(ctx, config?.runtime.offline === true) } : {}),
  };
  if (flagBool(args, "json")) {
    ctx.out(JSON.stringify(facts, null, 2));
    return 0;
  }
  const { profile } = await renderContext(args, ctx, { defaultsIfSettingsUnreadable: true });
  ctx.out(paint(aboutView(facts, profile), profile));
  return 0;
}

const USAGE = `Usage: jpe data [remove <${REMOVAL_SCOPES.join("|")}> [--confirm]] [--json]`;

/**
 * `jpe data` shows everything JPE stores. `jpe data remove <scope>` shows exactly what removing it would delete, and deletes
 * only when `--confirm` is added. Scopes: cache (documentation cache), records (this project's records, keeping backups),
 * backups (this project's file backups), all (settings, cache, and every project's records and backups).
 */
export async function dataCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const [sub, rawScope] = args.positionals;
  const json = flagBool(args, "json");
  const root = dataDir(ctx.pathEnv);
  const { profile } = await renderContext(args, ctx, { defaultsIfSettingsUnreadable: true });

  if (sub === undefined) {
    const inventory = await scanInventory(root, projectKey(ctx.cwd));
    ctx.out(json ? JSON.stringify(inventory, null, 2) : paint(dataView(inventory, ctx.now(), profile), profile));
    return 0;
  }

  if (sub === "remove") {
    if (rawScope === undefined || !(REMOVAL_SCOPES as readonly string[]).includes(rawScope)) throw new JpeError("INVALID_INPUT", `Choose what to remove: ${REMOVAL_SCOPES.join(", ")}. ${USAGE}`);
    const plan = await planRemoval(rawScope as RemovalScope, root, ctx.stateDir());
    const confirmed = flagBool(args, "confirm");
    const result = confirmed && plan.targets.length > 0 ? await executeRemoval(plan, root) : undefined;
    if (json) ctx.out(JSON.stringify({ scope: plan.scope, targets: plan.targets, stats: plan.stats, consequences: plan.consequences, confirmed, ...(result === undefined ? {} : { result }) }, null, 2));
    else ctx.out(paint(removalView(plan, root, result, profile), profile));
    return result !== undefined && result.failed.length > 0 ? 1 : 0;
  }

  throw new JpeError("INVALID_INPUT", `"${sub}" is not a data command. ${USAGE}`);
}

import { applyPreset, describeSettings, effectiveValue, findPreset, isSettingKey, PRESETS, settingSources, unsetPath, validateLayer } from "../../config/catalog.js";
import { envOverrides } from "../../config/load.js";
import { migrateConfig } from "../../config/migrate.js";
import { globalConfigPath, projectConfigPath } from "../../config/paths.js";
import { JpeError } from "../../core/errors.js";
import { presetListView, presetPreviewView, type PresetChange, settingDetailView, settingsView, type SettingRow } from "../../settings/views.js";
import { statusBadge } from "../../ui/components.js";
import { paint } from "../../ui/paint.js";
import { flagBool, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { scopeFile, writeScope } from "./admin.js";
import { renderContext } from "./render-profile.js";

type Plain = Record<string, unknown>;

const USAGE = "Usage: jpe settings [<setting> | unset <setting> | preset [<name>] [--apply]] [--project] [--json]";

/** One configuration file as plain data. A missing file is empty. A damaged one is an error the person is told about. */
async function readLayer(ctx: CliContext, file: string): Promise<Plain | undefined> {
  const text = await ctx.readText(file);
  if (text === undefined) return undefined;
  try {
    return migrateConfig(JSON.parse(text)) as Plain;
  } catch {
    throw new JpeError("INVALID_CONFIG", `The configuration file ${file} is not valid JSON, so it was not changed. Fix or remove it, then try again.`);
  }
}

async function rowsFor(ctx: CliContext): Promise<SettingRow[]> {
  const config = await ctx.loadConfig();
  const sources = settingSources({ global: await readLayer(ctx, globalConfigPath(ctx.pathEnv)), project: await readLayer(ctx, projectConfigPath(ctx.cwd)), environment: envOverrides(ctx.pathEnv.env) });
  return describeSettings().map((s) => ({ ...s, value: effectiveValue(config, s.key), source: sources[s.key] ?? "default" }));
}

async function writeChecked(ctx: CliContext, file: string, layer: Plain): Promise<string[]> {
  const problem = validateLayer(layer);
  if (problem !== undefined) throw new JpeError("INVALID_CONFIG", `That change is not allowed, so nothing was written: ${problem}`);
  return writeScope(ctx, file, { ...layer, schemaVersion: 1 });
}

/**
 * `jpe settings [<setting>]`, `jpe settings unset <setting>`, `jpe settings preset [<name>] [--apply]`
 *
 * Shows every setting with its meaning, allowed values, default and where its value comes from; puts a setting back to
 * its default; and offers accessibility and appearance presets. Nothing changes unless `unset` or `preset --apply` is
 * used, and the file that is replaced is always kept as a backup.
 */
export async function settingsCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const [sub, target] = args.positionals;
  const json = flagBool(args, "json");
  const { profile } = await renderContext(args, ctx);
  const project = flagBool(args, "project");
  const scopeName = project ? "this project's settings" : "your settings";

  if (sub === undefined) {
    const rows = await rowsFor(ctx);
    ctx.out(json ? JSON.stringify(rows, null, 2) : paint(settingsView(rows, profile), profile));
    return 0;
  }

  if (sub === "unset") {
    if (target === undefined || !isSettingKey(target)) throw new JpeError("INVALID_INPUT", `"${target ?? ""}" is not a setting. Run \`jpe settings\` to see them all. ${USAGE}`);
    const file = scopeFile(args, ctx);
    const layer = (await readLayer(ctx, file)) ?? {};
    const updated = unsetPath(layer, target);
    if (JSON.stringify(updated) === JSON.stringify(layer)) {
      ctx.out(paint(statusBadge("info", `${target} is not set in ${scopeName}, so there is nothing to remove. It may come from another place: run \`jpe settings ${target}\`.`, profile), profile));
      return 0;
    }
    const notes = await writeChecked(ctx, file, updated);
    ctx.out([paint(statusBadge("success", `${target} is back to its default in ${scopeName}.`, profile), profile), ...notes].join("\n"));
    return 0;
  }

  if (sub === "preset") {
    if (target === undefined) {
      ctx.out(json ? JSON.stringify(PRESETS, null, 2) : paint(presetListView(PRESETS, profile), profile));
      return 0;
    }
    const preset = findPreset(target);
    if (preset === undefined) throw new JpeError("INVALID_INPUT", `There is no preset called "${target}". Run \`jpe settings preset\` to list them.`);
    const file = scopeFile(args, ctx);
    const layer = (await readLayer(ctx, file)) ?? {};
    const updated = applyPreset(layer, preset);
    const problem = validateLayer(updated);
    if (problem !== undefined) throw new JpeError("INVALID_CONFIG", `That preset cannot be applied: ${problem}`);
    const config = await ctx.loadConfig();
    const defaults = new Map(describeSettings().map((s) => [s.key, s.default]));
    const keys = [...Object.keys(preset.set), ...preset.unset];
    const changes: PresetChange[] = keys.map((key) => {
      const toDefault = preset.unset.includes(key);
      return { key, from: effectiveValue(config, key), to: toDefault ? defaults.get(key) : preset.set[key], toDefault };
    });
    const apply = flagBool(args, "apply");
    const notes = apply && JSON.stringify(updated) !== JSON.stringify(layer) ? await writeChecked(ctx, file, updated) : [];
    ctx.out(json ? JSON.stringify({ preset: preset.name, applied: apply, changes }, null, 2) : [paint(presetPreviewView(preset, changes, apply, notes.length > 0, scopeName, profile), profile), ...notes].join("\n"));
    return 0;
  }

  if (isSettingKey(sub)) {
    const row = (await rowsFor(ctx)).find((r) => r.key === sub);
    if (row === undefined) throw new JpeError("INVALID_INPUT", USAGE);
    ctx.out(json ? JSON.stringify(row, null, 2) : paint(settingDetailView(row, profile), profile));
    return 0;
  }

  throw new JpeError("INVALID_INPUT", `"${sub}" is not a setting or a settings command. ${USAGE}`);
}

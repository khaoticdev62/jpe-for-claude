import { defaultConfig } from "../../config/defaults.js";
import { uiSettingsSchema } from "../../config/schema.js";
import { JpeError } from "../../core/errors.js";
import { type Capabilities, detectCapabilities, MAX_COLUMNS, MIN_COLUMNS } from "../../ui/capabilities.js";
import { type RenderProfile, resolveProfile, type UiSettings } from "../../ui/profile.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";

/** Flags that override the saved `ui` settings for one run, named as in the configuration. */
const SETTING_FLAGS = ["theme", "color", "unicode", "density", "motion", "navigation"] as const;

function parseWidth(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const width = /^\d{1,4}$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!(width >= MIN_COLUMNS && width <= MAX_COLUMNS)) throw new JpeError("INVALID_INPUT", `--width must be a whole number from ${MIN_COLUMNS} to ${MAX_COLUMNS}.`);
  return width;
}

/** Saved settings with this run's flags on top, validated by the same schema as the configuration file. */
export function settingsFor(args: ParsedArgs, saved: UiSettings): UiSettings {
  const merged: Record<string, unknown> = { ...saved };
  for (const name of SETTING_FLAGS) {
    const value = flagString(args, name);
    if (value !== undefined) merged[name] = value;
  }
  if (flagBool(args, "screen-reader")) merged["screenReader"] = true;
  const parsed = uiSettingsSchema.safeParse(merged);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "ui"}: ${issue.message}`);
    throw new JpeError("INVALID_INPUT", `Those display settings are not valid. ${problems.join(" ")}`);
  }
  return parsed.data;
}

/** What a command needs to draw: what the terminal can do, and the settings and flags resolved into one profile. */
export async function renderContext(args: ParsedArgs, ctx: CliContext, options: { defaultsIfSettingsUnreadable?: boolean } = {}): Promise<{ caps: Capabilities; profile: RenderProfile }> {
  const config = options.defaultsIfSettingsUnreadable ? await ctx.loadConfig().catch(() => defaultConfig()) : await ctx.loadConfig();
  const terminal = ctx.terminal();
  const caps = detectCapabilities({ env: ctx.pathEnv.env, platform: ctx.pathEnv.platform, isTTY: terminal.isTTY, columns: terminal.columns, rows: terminal.rows });
  const width = parseWidth(flagString(args, "width"));
  return { caps, profile: resolveProfile(caps, settingsFor(args, config.ui), width === undefined ? {} : { width }) };
}

import { uiSettingsSchema } from "../../config/schema.js";
import { JpeError } from "../../core/errors.js";
import { detectCapabilities, MAX_COLUMNS, MIN_COLUMNS } from "../../ui/capabilities.js";
import { blank, bulletList, heading, statusBadge, table } from "../../ui/components.js";
import type { Line } from "../../ui/doc.js";
import { ACTIONS, chordLabel } from "../../ui/keymap.js";
import { paint } from "../../ui/paint.js";
import { buildPreview, summarizeProfile } from "../../ui/preview.js";
import { resolveProfile, type UiSettings } from "../../ui/profile.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";

/** Flags that override the saved `ui` settings for this one run, named as in the config. */
const SETTING_FLAGS = ["theme", "color", "unicode", "density", "motion", "navigation"] as const;

function parseWidth(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const width = /^\d{1,4}$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!(width >= MIN_COLUMNS && width <= MAX_COLUMNS)) throw new JpeError("INVALID_INPUT", `--width must be a whole number from ${MIN_COLUMNS} to ${MAX_COLUMNS}.`);
  return width;
}

/** Saved settings with this run's flags on top, validated by the same schema as the configuration file. */
function settingsFor(args: ParsedArgs, saved: UiSettings): UiSettings {
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

function keysScreen(profile: ReturnType<typeof resolveProfile>): Line[] {
  const rows = ACTIONS.map((action) => [action, profile.keymap.byAction[action].map(chordLabel).join(", ")]);
  const problems = profile.keymap.problems.flatMap((problem) => statusBadge("warning", `${problem.action}: ${problem.message}`, profile));
  return [
    ...heading("Keyboard shortcuts", profile),
    ...table({ columns: [{ header: "Action" }, { header: "Keys" }], rows }, profile),
    blank(),
    ...(problems.length === 0 ? bulletList(["Digits 1 to 9 jump to the matching numbered item in any list."], profile) : [...heading("Shortcut settings that were ignored", profile), ...problems]),
  ];
}

/**
 * `jpe ui [preview|keys] [--theme t] [--color c] [--unicode on|off] [--width n] [--density d] [--motion m] [--screen-reader] [--json]`
 * Shows what JPE detected about this terminal and a live sample of how it will draw. Changes nothing.
 */
export async function uiCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const view = args.positionals[0] ?? "preview";
  if (view !== "preview" && view !== "keys") throw new JpeError("INVALID_INPUT", `Unknown view "${view}". Use "jpe ui" or "jpe ui keys".`);

  const config = await ctx.loadConfig();
  const settings = settingsFor(args, config.ui);
  const terminal = ctx.terminal();
  const caps = detectCapabilities({ env: ctx.pathEnv.env, platform: ctx.pathEnv.platform, isTTY: terminal.isTTY, columns: terminal.columns, rows: terminal.rows });
  const width = parseWidth(flagString(args, "width"));
  const profile = resolveProfile(caps, settings, width === undefined ? {} : { width });

  if (flagBool(args, "json")) {
    const payload = view === "keys" ? { byAction: profile.keymap.byAction, problems: profile.keymap.problems } : { profile: summarizeProfile(profile), reasons: caps.reasons, shortcutProblems: profile.keymap.problems };
    ctx.out(JSON.stringify(payload, null, 2));
    return 0;
  }
  ctx.out(paint(view === "keys" ? keysScreen(profile) : buildPreview(caps, profile), profile));
  return 0;
}

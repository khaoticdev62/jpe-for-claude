/**
 * Screens for the settings center. Pure: they draw the catalog and the current values and change nothing.
 */

import { type Preset, type SettingInfo, type SettingSource, formatValue } from "../config/catalog.js";
import { blank, bulletList, heading, keyValues, table, textLines } from "../ui/components.js";
import type { Line } from "../ui/doc.js";
import type { RenderProfile } from "../ui/profile.js";
import { inline } from "../ui/text.js";

export interface SettingRow extends SettingInfo {
  value: unknown;
  source: SettingSource;
}

const SOURCE_WORDS: Record<SettingSource, string> = { default: "default", global: "your setting", project: "this project", environment: "environment" };

export function settingsView(rows: readonly SettingRow[], profile: RenderProfile): Line[] {
  const out: Line[] = [...heading("Settings", profile)];
  const changed = rows.filter((r) => r.source !== "default").length;
  out.push(...textLines(`${rows.length} settings; ${changed === 0 ? "all at their defaults" : `${changed} changed from the default`}.`, profile.width));
  const groups = [...new Set(rows.map((r) => r.group))];
  for (const group of groups) {
    out.push(blank(), ...heading(group, profile));
    out.push(
      ...table(
        { columns: [{ header: "Setting", min: 12 }, { header: "Value", min: 8 }, { header: "From", min: 7 }], rows: rows.filter((r) => r.group === group).map((r) => [r.key, formatValue(r.value), SOURCE_WORDS[r.source]]) },
        profile,
      ),
    );
  }
  out.push(blank(), ...bulletList(["`jpe settings <setting>` explains one, for example `jpe settings ui.theme`.", "`jpe config set <setting> <value>` changes one; `jpe settings unset <setting>` puts it back to its default.", "`jpe settings preset` lists accessibility and appearance presets."], profile));
  return out;
}

export function settingDetailView(row: SettingRow, profile: RenderProfile): Line[] {
  return [
    ...heading(row.key, profile),
    ...textLines(row.summary, profile.width),
    blank(),
    ...keyValues(
      [
        ["Current", formatValue(row.value)],
        ["From", SOURCE_WORDS[row.source]],
        ["Default", formatValue(row.default)],
        ["Allowed", inline(row.allowed)],
      ],
      profile,
    ),
    blank(),
    ...textLines(`Change it: jpe config set ${row.key} <value>   (add --project for this project only)`, profile.width, { role: "muted" }),
    ...textLines(`Put it back: jpe settings unset ${row.key}`, profile.width, { role: "muted" }),
  ];
}

export function presetListView(presets: readonly Preset[], profile: RenderProfile): Line[] {
  return [
    ...heading("Presets", profile),
    ...bulletList(presets.map((p) => `${p.name}: ${p.summary}`), profile),
    blank(),
    ...textLines("`jpe settings preset <name>` shows exactly what would change. Add --apply to make the change (add --project for this project only).", profile.width, { role: "muted" }),
  ];
}

export interface PresetChange {
  key: string;
  from: unknown;
  /** The new value, or undefined when the setting is put back to its default. */
  to: unknown;
  toDefault: boolean;
}

export function presetPreviewView(preset: Preset, changes: readonly PresetChange[], applied: boolean, backedUp: boolean, scope: string, profile: RenderProfile): Line[] {
  const out: Line[] = [...heading(`Preset: ${preset.name}`, profile), ...textLines(preset.summary, profile.width), blank()];
  const real = changes.filter((c) => formatValue(c.from) !== formatValue(c.to));
  if (real.length === 0) {
    out.push(...textLines("Nothing would change: every setting in this preset already has that value.", profile.width));
    return out;
  }
  out.push(...table({ columns: [{ header: "Setting", min: 12 }, { header: "Now", min: 6 }, { header: applied ? "Changed to" : "Would become", min: 8 }], rows: real.map((c) => [c.key, formatValue(c.from), c.toDefault ? `${formatValue(c.to)} (default)` : formatValue(c.to)]) }, profile));
  out.push(blank(), ...textLines(applied ? `Applied to ${scope}.${backedUp ? " The previous file was kept as a backup." : ""}` : "Nothing has been changed. Run again with --apply to make this change.", profile.width, { role: "muted" }));
  return out;
}

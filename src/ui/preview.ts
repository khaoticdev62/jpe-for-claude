/**
 * The `jpe ui` screen: what JPE detected about the terminal, why, and a live sample of every building block
 * drawn with the resolved settings. It is also the quickest way to check a theme or a width before relying on it.
 */

import type { Capabilities } from "./capabilities.js";
import { contrastRatio } from "./color.js";
import { ALL_STATUSES, blank, bulletList, heading, keyHints, keyValues, panel, progressBar, table, textLines, verificationBadge } from "./components.js";
import type { Line } from "./doc.js";
import { fitLine, span } from "./doc.js";
import { chordLabel } from "./keymap.js";
import type { RenderProfile } from "./profile.js";
import { breakpointFor } from "./profile.js";
import { pad } from "./text.js";
import { ROLES } from "./tokens.js";

const yesNo = (value: boolean): string => (value ? "yes" : "no");

/** Plain facts about the resolved profile, shared by the text screen and the JSON output. */
export function summarizeProfile(profile: RenderProfile): Record<string, string | number | boolean> {
  return {
    theme: profile.theme.name,
    color: profile.color,
    styles: profile.styles,
    unicode: profile.unicode,
    width: profile.width,
    layout: breakpointFor(profile.width),
    density: profile.density,
    motion: profile.motion,
    screenReader: profile.screenReader,
  };
}

const SAMPLE_COLUMN_MIN_WIDTH = 40;

/** The palette, one row per role, adapting to the width: the sample column is dropped when narrow, and a screen reader gets sentences. */
function paletteLines(profile: RenderProfile): Line[] {
  const { theme, width } = profile;
  const ratio = (hex: string): string => `${contrastRatio(hex, theme.background).toFixed(1)}:1`;
  if (profile.screenReader) return ROLES.flatMap((role) => textLines(`${role}: ${theme.colors[role]}, contrast ${contrastRatio(theme.colors[role], theme.background).toFixed(1)} to 1`, width));

  const withSample = width >= SAMPLE_COLUMN_MIN_WIDTH;
  const head: Line = [span(`${pad("Role", 10)}${withSample ? pad("Sample", 14) : ""}${pad("Colour", 9)}Contrast`, { role: "muted" })];
  const rows = ROLES.map((role): Line => {
    const hex = theme.colors[role];
    return [span(pad(role, 10)), ...(withSample ? [span(pad("Sample text", 14), { role })] : []), span(pad(hex, 9), { role: withSample ? "muted" : role }), span(ratio(hex))];
  });
  return [head, ...rows].map((line) => fitLine(line, width, profile.symbols.ellipsis));
}

/** The whole `jpe ui` screen as a document. */
export function buildPreview(caps: Capabilities, profile: RenderProfile): Line[] {
  const sampleKeys = ["up", "down", "select", "back", "search", "palette", "help", "quit"] as const;
  const navigation = `${profile.keymap.byAction.up.map(chordLabel).join("/")} and ${profile.keymap.byAction.down.map(chordLabel).join("/")} to move`;

  return [
    ...heading("JPE terminal interface", profile),
    ...keyValues(
      [
        ["Theme", `${profile.theme.name} (${profile.theme.mode})`],
        ["Colour", profile.color],
        ["Symbols", profile.unicode ? "Unicode" : "ASCII"],
        ["Width", `${profile.width} columns (${breakpointFor(profile.width)} layout)`],
        ["Density", profile.density],
        ["Motion", profile.motion],
        ["Screen reader", yesNo(profile.screenReader)],
        ["Navigation", navigation],
        ["Remote session", yesNo(caps.remote)],
      ],
      profile,
    ),
    blank(),
    ...heading("Why", profile),
    ...bulletList(caps.reasons, profile),
    blank(),
    ...heading(`Palette (contrast measured on ${profile.theme.background})`, profile),
    ...paletteLines(profile),
    blank(),
    ...heading("Status words", profile),
    ...ALL_STATUSES.flatMap((status) => verificationBadge(status, profile)),
    blank(),
    ...heading("Samples (example data only)", profile),
    progressBar({ ratio: 0, label: pad("Empty", 6) }, profile),
    progressBar({ ratio: 0.45, label: pad("Part", 6) }, profile),
    progressBar({ ratio: 1, label: pad("Full", 6) }, profile),
    blank(),
    ...panel(
      {
        title: "Sample panel",
        body: [
          ...textLines("Panels wrap text to stay inside their border.", profile.width - 4),
          ...textLines("A line that cannot wrap is cut with an ellipsis.", profile.width - 4, { role: "muted" }),
        ],
      },
      profile,
    ),
    blank(),
    ...table(
      {
        columns: [{ header: "Check" }, { header: "Result" }, { header: "Time", align: "right", min: 4 }],
        rows: [
          ["example-a", "passed", "2.1s"],
          ["example-b", "passed", "0.4s"],
          ["example-c", "failed", "24.0s"],
        ],
      },
      profile,
    ),
    blank(),
    ...keyHints(sampleKeys, profile),
  ];
}

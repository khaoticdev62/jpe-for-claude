/**
 * The JPE design tokens: one palette per theme, a fixed set of semantic roles, and a 16-colour fallback for every role.
 *
 * The default theme uses the locked JPE palette (background #121212, surface #292929, text #F0F0F0,
 * secondary text #BDBDBD, accent #9B6DFF). The other themes exist for accessibility: higher contrast,
 * colour-blind-safe hues, and a light variant. Every value is checked against WCAG contrast in the tests.
 *
 * Colour is never the only signal: status roles are always paired with a glyph and a word (see components.ts).
 */

export const THEME_NAMES = ["jpe", "jpe-contrast", "jpe-colorblind", "jpe-light"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** What a piece of text means, independent of how it is painted. */
export const ROLES = ["text", "muted", "heading", "accent", "success", "warning", "error", "info", "inactive", "pending", "border"] as const;
export type Role = (typeof ROLES)[number];

/** Roles that carry a status meaning and therefore always travel with a glyph and a label. */
export const STATUS_ROLES = ["success", "warning", "error", "info", "inactive", "pending"] as const;
export type StatusRole = (typeof STATUS_ROLES)[number];

export interface Theme {
  name: ThemeName;
  description: string;
  /** Whether the theme is meant for a dark or a light terminal background. */
  mode: "dark" | "light";
  /** Page background, used only where JPE paints its own surface (panes), never over the user's terminal. */
  background: string;
  /** Raised panel background, same rule as `background`. */
  surface: string;
  /** Truecolor and 256-colour values per role. `text` and `muted` double as the pane foregrounds. */
  colors: Readonly<Record<Role, string>>;
  /** xterm 0-15 index per role, for 16-colour terminals. */
  ansi16: Readonly<Record<Role, number>>;
}

const ANSI16_DARK: Theme["ansi16"] = { text: 7, muted: 8, heading: 13, accent: 13, success: 10, warning: 11, error: 9, info: 12, inactive: 8, pending: 14, border: 8 };
const ANSI16_LIGHT: Theme["ansi16"] = { text: 0, muted: 8, heading: 5, accent: 5, success: 2, warning: 3, error: 1, info: 4, inactive: 8, pending: 6, border: 8 };

export const THEMES: Readonly<Record<ThemeName, Theme>> = {
  jpe: {
    name: "jpe",
    description: "The JPE identity: near-black background, violet accent.",
    mode: "dark",
    background: "#121212",
    surface: "#292929",
    colors: {
      text: "#F0F0F0",
      muted: "#BDBDBD",
      heading: "#FAFAFA",
      accent: "#9B6DFF",
      success: "#5FD38D",
      warning: "#F2B84B",
      error: "#FF6B6B",
      info: "#5CB8FF",
      inactive: "#8A8A8A",
      pending: "#8FBCD4",
      border: "#8A8A8A",
    },
    ansi16: ANSI16_DARK,
  },
  "jpe-contrast": {
    name: "jpe-contrast",
    description: "High contrast: black background, every text role at least 7:1 (WCAG AAA).",
    mode: "dark",
    background: "#000000",
    surface: "#1A1A1A",
    colors: {
      text: "#FFFFFF",
      muted: "#E6E6E6",
      heading: "#FFFFFF",
      accent: "#CDB4FF",
      success: "#7CFFB2",
      warning: "#FFD866",
      error: "#FF8A8A",
      info: "#8CD2FF",
      inactive: "#BFBFBF",
      pending: "#B3E5FC",
      border: "#BFBFBF",
    },
    ansi16: ANSI16_DARK,
  },
  "jpe-colorblind": {
    name: "jpe-colorblind",
    description: "Colour-blind safe: status hues from the Okabe-Ito palette (blue, yellow, reddish purple) instead of green and red.",
    mode: "dark",
    background: "#121212",
    surface: "#292929",
    colors: {
      text: "#F0F0F0",
      muted: "#BDBDBD",
      heading: "#FAFAFA",
      accent: "#9B6DFF",
      success: "#56B4E9",
      warning: "#F0E442",
      error: "#E58BBB",
      info: "#E6E6E6",
      inactive: "#8A8A8A",
      pending: "#3DD6A5",
      border: "#8A8A8A",
    },
    ansi16: { ...ANSI16_DARK, success: 12, warning: 11, error: 13, info: 15, pending: 14 },
  },
  "jpe-light": {
    name: "jpe-light",
    description: "For light terminal backgrounds.",
    mode: "light",
    background: "#FAFAFA",
    surface: "#EDEDED",
    colors: {
      text: "#1A1A1A",
      muted: "#4A4A4A",
      heading: "#000000",
      accent: "#6B3FD4",
      success: "#12703E",
      warning: "#8A5A00",
      error: "#B3261E",
      info: "#0B5FA5",
      inactive: "#6B6B6B",
      pending: "#2E6F8E",
      border: "#6B6B6B",
    },
    ansi16: ANSI16_LIGHT,
  },
};

export const isThemeName = (value: string): value is ThemeName => (THEME_NAMES as readonly string[]).includes(value);

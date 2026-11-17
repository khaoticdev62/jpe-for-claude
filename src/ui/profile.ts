/**
 * The render profile: everything a component needs to decide how to draw, resolved once from the terminal's
 * capabilities, the person's settings and any command-line overrides. Explicit settings always beat detection.
 */

import type { Capabilities, ColorDepth } from "./capabilities.js";
import { MAX_COLUMNS, MIN_COLUMNS } from "./capabilities.js";
import { buildKeymap, type Keymap, type NavigationStyle } from "./keymap.js";
import { type SymbolSet, symbolsFor } from "./symbols.js";
import { THEMES, type Theme, type ThemeName } from "./tokens.js";

/** The settings this module reads: the `ui` section of the JPE configuration. */
export interface UiSettings {
  theme: ThemeName;
  color: "auto" | ColorDepth;
  unicode: "auto" | "on" | "off";
  density: "auto" | "compact" | "comfortable";
  motion: "auto" | "full" | "reduced";
  screenReader: boolean;
  navigation: NavigationStyle;
  shortcuts: Parameters<typeof buildKeymap>[1];
}

/**
 * The defaults for the `ui` settings, for code that cannot load the configuration schema (the in-Claude-Code module
 * is bundled without it). A test asserts these equal the schema's own defaults, so there is still one truth.
 */
export const DEFAULT_UI_SETTINGS: UiSettings = { theme: "jpe", color: "auto", unicode: "auto", density: "auto", motion: "auto", screenReader: false, navigation: "both", shortcuts: {} };

export type Density = "compact" | "comfortable";
export type Breakpoint = "narrow" | "medium" | "wide";

export interface RenderProfile {
  theme: Theme;
  color: ColorDepth;
  /** Bold, dim and underline may be emitted. When false the output has no escape sequences at all. */
  styles: boolean;
  unicode: boolean;
  symbols: SymbolSet;
  /** Usable width in columns. */
  width: number;
  density: Density;
  motion: "full" | "reduced";
  screenReader: boolean;
  /**
   * terminal: JPE paints only foreground accents and leaves the user's background alone (the command line).
   * own: JPE paints its own background and surface (a pane it owns), so the theme's text colours apply too.
   */
  surface: "terminal" | "own";
  keymap: Keymap;
}

/** Narrow below 60 columns, medium below 100, wide above. Components switch layout at these points. */
export function breakpointFor(width: number): Breakpoint {
  if (width < 60) return "narrow";
  return width < 100 ? "medium" : "wide";
}

export interface ProfileOverrides {
  width?: number;
  surface?: RenderProfile["surface"];
}

/** Resolves capabilities plus settings into one profile. Never throws. */
export function resolveProfile(caps: Capabilities, settings: UiSettings, overrides: ProfileOverrides = {}): RenderProfile {
  const width = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.trunc(overrides.width ?? caps.columns)));
  const color = settings.color === "auto" ? caps.color : settings.color;
  const unicode = settings.unicode === "auto" ? caps.unicode : settings.unicode === "on";
  const density: Density = settings.density === "auto" ? (width < 80 || caps.rows < 24 ? "compact" : "comfortable") : settings.density;
  const motion = settings.motion === "auto" ? (caps.reducedMotion ? "reduced" : "full") : settings.motion;
  return {
    theme: THEMES[settings.theme],
    color,
    // An explicit colour setting means the person wants styling even where detection said "not a terminal".
    styles: caps.styles || (settings.color !== "auto" && settings.color !== "none"),
    unicode,
    symbols: symbolsFor(unicode),
    width,
    density,
    motion,
    screenReader: settings.screenReader || caps.screenReader,
    surface: overrides.surface ?? "terminal",
    keymap: buildKeymap(settings.navigation, settings.shortcuts),
  };
}

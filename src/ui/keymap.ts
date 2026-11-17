/**
 * Keyboard navigation as data: actions, default bindings (standard arrows, Vim-style, or both), numbered selection,
 * and user overrides that are validated so one key can never silently do two things.
 *
 * This module only decides "which action does this key press mean". Reading the keyboard and drawing the result
 * belong to the interface layer built on top of it.
 */

export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "select",
  "back",
  "quit",
  "search",
  "palette",
  "help",
  "next-pane",
  "prev-pane",
  "top",
  "bottom",
  "page-up",
  "page-down",
  "toggle-expand",
  "favorite",
  "refresh",
] as const;
export type Action = (typeof ACTIONS)[number];

export const NAVIGATION_STYLES = ["standard", "vim", "both"] as const;
export type NavigationStyle = (typeof NAVIGATION_STYLES)[number];

/**
 * A key chord: optional `ctrl+`, `alt+`, `shift+` prefixes and one key. Letters may be written in either case;
 * a capital letter means shift+letter. Examples: `j`, `G`, `ctrl+p`, `shift+tab`, `enter`, `f5`.
 */
export const CHORD_PATTERN = /^(?:(?:ctrl|alt|shift)\+)*(?:[a-zA-Z0-9/?:.,;'=\-[\]\\`]|enter|esc|tab|space|up|down|left|right|home|end|pageup|pagedown|backspace|delete|f(?:[1-9]|1[0-2]))$/;

const MODIFIER_ORDER = ["ctrl", "alt", "shift"] as const;
const NAMED_KEYS: ReadonlySet<string> = new Set(["enter", "esc", "tab", "space", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "backspace", "delete"]);

/** Chords that cannot be reassigned: they are how a person always gets out. */
const RESERVED: Readonly<Record<string, Action>> = { "ctrl+c": "quit", esc: "back" };

/** Canonical spelling of a chord (`Ctrl+P` becomes `ctrl+p`, `G` becomes `shift+g`), or undefined when it is not valid. */
export function normalizeChord(raw: string): string | undefined {
  const text = raw.trim();
  if (!CHORD_PATTERN.test(text)) return undefined;
  const parts = text.split("+");
  // A trailing "+" key ("ctrl++") splits into empty parts; this pattern does not allow it, so every part is non-empty here.
  const key = parts.at(-1) ?? "";
  const modifiers = new Set(parts.slice(0, -1));
  let name = key;
  if (key.length === 1 && key !== key.toLowerCase()) {
    modifiers.add("shift");
    name = key.toLowerCase();
  } else if (key.length > 1) {
    name = key.toLowerCase();
  }
  const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m));
  return [...ordered, name].join("+");
}

export interface KeyEvent {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** The chord a key event spells, or undefined for a key this layer does not model. */
export function chordOf(event: KeyEvent): string | undefined {
  const key = event.key.length === 1 ? event.key : event.key.toLowerCase();
  const modifiers = [event.ctrl ? "ctrl" : "", event.alt ? "alt" : "", event.shift ? "shift" : ""].filter(Boolean);
  const isNamed = NAMED_KEYS.has(key) || /^f(?:[1-9]|1[0-2])$/.test(key);
  if (!isNamed && key.length !== 1) return undefined;
  return normalizeChord([...modifiers, key].join("+"));
}

type Bindings = Readonly<Record<Action, readonly string[]>>;

const COMMON: Bindings = {
  up: [],
  down: [],
  left: [],
  right: [],
  select: ["enter"],
  back: ["esc", "backspace"],
  quit: ["q", "ctrl+c"],
  search: ["/"],
  palette: ["ctrl+p"],
  help: ["?"],
  "next-pane": ["tab"],
  "prev-pane": ["shift+tab"],
  top: [],
  bottom: [],
  "page-up": [],
  "page-down": [],
  "toggle-expand": ["space"],
  favorite: ["f"],
  refresh: ["r"],
};

const ARROWS: Partial<Bindings> = { up: ["up"], down: ["down"], left: ["left"], right: ["right"], top: ["home"], bottom: ["end"], "page-up": ["pageup"], "page-down": ["pagedown"] };
const VIM: Partial<Bindings> = { up: ["k"], down: ["j"], left: ["h"], right: ["l"], top: ["g"], bottom: ["shift+g"], "page-up": ["ctrl+u"], "page-down": ["ctrl+d"] };

/** The built-in bindings for a navigation style. */
export function defaultBindings(style: NavigationStyle): Bindings {
  const sources: Array<Partial<Bindings>> = style === "standard" ? [ARROWS] : style === "vim" ? [VIM] : [ARROWS, VIM];
  const merged = {} as Record<Action, string[]>;
  for (const action of ACTIONS) merged[action] = [...COMMON[action], ...sources.flatMap((s) => s[action] ?? [])];
  return merged;
}

export type KeymapProblemKind = "invalid-chord" | "reserved" | "conflict" | "empty";

export interface KeymapProblem {
  action: Action;
  chord: string;
  kind: KeymapProblemKind;
  message: string;
}

export interface Keymap {
  /** Chord to action. */
  bindings: ReadonlyMap<string, Action>;
  /** Action to its chords, for help screens. */
  byAction: Readonly<Record<Action, readonly string[]>>;
  /** Everything about the user's overrides that was refused, and why. Empty when all was accepted. */
  problems: readonly KeymapProblem[];
}

/**
 * Builds the keymap for a navigation style plus optional per-action overrides.
 * An override replaces that action's defaults. A chord is refused when it is invalid, reserved, or already
 * claimed by another action; if all of an action's override chords are refused, the action keeps its defaults.
 */
export function buildKeymap(style: NavigationStyle, overrides: Partial<Record<Action, readonly string[]>> = {}): Keymap {
  const defaults = defaultBindings(style);
  const problems: KeymapProblem[] = [];
  const desired = {} as Record<Action, string[]>;
  const overridden = new Set<Action>();

  for (const action of ACTIONS) {
    const supplied = overrides[action];
    if (supplied === undefined) {
      desired[action] = [...defaults[action]];
      continue;
    }
    overridden.add(action);
    const accepted: string[] = [];
    for (const raw of supplied) {
      const chord = normalizeChord(raw);
      if (chord === undefined) problems.push({ action, chord: raw, kind: "invalid-chord", message: `"${raw}" is not a valid key.` });
      else if (RESERVED[chord] !== undefined && RESERVED[chord] !== action) problems.push({ action, chord, kind: "reserved", message: `${chord} is reserved for "${RESERVED[chord]}" so you can always leave.` });
      else if (!accepted.includes(chord)) accepted.push(chord);
    }
    desired[action] = accepted;
  }

  // Reserved chords stay where they are even if an override moved their action away.
  for (const [chord, action] of Object.entries(RESERVED)) {
    if (!desired[action].includes(chord)) desired[action].push(chord);
  }

  // Resolve collisions until none remain. A chord claimed by several actions goes to its reserved owner, else to a
  // default holder over overrides; two overrides on one chord both lose it. An action left with no key reverts to its
  // defaults and counts as a default holder from then on, which is why this repeats instead of running once.
  const MAX_PASSES = 50;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    for (const action of overridden) {
      if (desired[action].length > 0) continue;
      overridden.delete(action);
      desired[action] = [...defaults[action]];
      problems.push({ action, chord: "", kind: "empty", message: `No usable key was left for "${action}", so its defaults were kept.` });
    }

    const claims = new Map<string, Action[]>();
    for (const action of ACTIONS) for (const chord of desired[action]) claims.set(chord, [...(claims.get(chord) ?? []), action]);
    const collisions = [...claims].filter(([, actions]) => actions.length > 1);
    if (collisions.length === 0) break;

    for (const [chord, actions] of collisions) {
      const owner = RESERVED[chord];
      const defaultHolders = actions.filter((a) => !overridden.has(a));
      const losers = owner !== undefined && actions.includes(owner) ? actions.filter((a) => a !== owner) : defaultHolders.length > 0 ? actions.filter((a) => overridden.has(a)) : actions;
      for (const action of losers) {
        if (!desired[action].includes(chord)) continue;
        desired[action] = desired[action].filter((c) => c !== chord);
        problems.push({ action, chord, kind: "conflict", message: `${chord} is already used by ${actions.filter((a) => a !== action).join(", ")}.` });
      }
    }
  }

  const bindings = new Map<string, Action>();
  for (const action of ACTIONS) for (const chord of desired[action]) if (!bindings.has(chord)) bindings.set(chord, action);
  return { bindings, byAction: desired, problems };
}

export type ResolvedKey = { action: Action } | { action: "jump"; index: number };

/**
 * What a key press means. With `numbered` on, the digits 1 to 9 jump to the first to ninth item
 * (index 0 to 8) unless the person bound that digit to an action.
 */
export function resolveKey(keymap: Keymap, event: KeyEvent, options: { numbered?: boolean } = {}): ResolvedKey | undefined {
  const chord = chordOf(event);
  if (chord === undefined) return undefined;
  const action = keymap.bindings.get(chord);
  if (action !== undefined) return { action };
  if (options.numbered && /^[1-9]$/.test(chord)) return { action: "jump", index: Number.parseInt(chord, 10) - 1 };
  return undefined;
}

const KEY_LABELS: Readonly<Record<string, string>> = { esc: "Esc", enter: "Enter", tab: "Tab", space: "Space", backspace: "Backspace", delete: "Delete", pageup: "PgUp", pagedown: "PgDn", home: "Home", end: "End", up: "Up", down: "Down", left: "Left", right: "Right" };

/**
 * A chord as a person reads it, always as text. Letters are lowercase (`j`) so they are not mistaken for Shift+letter;
 * `shift+g` alone reads `G`; with ctrl or alt the letter is upper case by convention (`Ctrl+P`).
 */
export function chordLabel(chord: string): string {
  const parts = chord.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  if (modifiers.length === 1 && modifiers[0] === "shift" && key.length === 1) return key.toUpperCase();
  const hasModifier = modifiers.some((m) => m !== "shift");
  const keyLabel = KEY_LABELS[key] ?? (key.length === 1 ? (hasModifier ? key.toUpperCase() : key) : `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`);
  return [...modifiers.map((m) => `${m.slice(0, 1).toUpperCase()}${m.slice(1)}`), keyLabel].join("+");
}

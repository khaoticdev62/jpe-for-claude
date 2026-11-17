import { describe, expect, it } from "vitest";
import { configSchema, uiSettingsSchema } from "../../src/config/schema.js";
import { ACTIONS, NAVIGATION_STYLES, buildKeymap, chordLabel, chordOf, defaultBindings, normalizeChord, resolveKey, type Action } from "../../src/ui/keymap.js";

describe("normalizeChord", () => {
  it.each([
    ["j", "j"],
    ["J", "shift+j"],
    ["G", "shift+g"],
    ["ctrl+p", "ctrl+p"],
    ["shift+tab", "shift+tab"],
    ["alt+ctrl+x", "ctrl+alt+x"],
    ["shift+ctrl+alt+x", "ctrl+alt+shift+x"],
    ["enter", "enter"],
    ["pagedown", "pagedown"],
    ["f5", "f5"],
    ["f12", "f12"],
    ["/", "/"],
    ["?", "?"],
    ["  ctrl+p  ", "ctrl+p"],
    ["1", "1"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeChord(input)).toBe(expected);
  });

  it.each(["", "ctrl+", "ctrl+ctrl", "ctrl++", "foo", "Ctrl+P", "f13", "f0", "ctrl+shift", "a b", "ab", "+"])("rejects %j", (input) => {
    expect(normalizeChord(input)).toBeUndefined();
  });
});

describe("chordOf", () => {
  it("turns key events into canonical chords", () => {
    expect(chordOf({ key: "j" })).toBe("j");
    expect(chordOf({ key: "G" })).toBe("shift+g");
    expect(chordOf({ key: "p", ctrl: true })).toBe("ctrl+p");
    expect(chordOf({ key: "Tab", shift: true })).toBe("shift+tab");
    expect(chordOf({ key: "enter" })).toBe("enter");
    expect(chordOf({ key: "F5" })).toBe("f5");
  });
  it("ignores keys this layer does not model", () => {
    expect(chordOf({ key: "Dead" })).toBeUndefined();
    expect(chordOf({ key: "" })).toBeUndefined();
    expect(chordOf({ key: "ArrowUp" })).toBeUndefined();
  });
});

describe("default bindings", () => {
  it.each(NAVIGATION_STYLES)("%s: every action has a key, and no key does two things", (style) => {
    const map = buildKeymap(style);
    expect(map.problems).toEqual([]);
    const all = ACTIONS.flatMap((a) => map.byAction[a]);
    expect(new Set(all).size).toBe(all.length);
    expect(map.bindings.size).toBe(all.length);
    for (const action of ACTIONS) expect(map.byAction[action].length, `${style} ${action}`).toBeGreaterThan(0);
  });

  it("standard uses arrows and no Vim letters; vim uses Vim letters and no arrows; both has both", () => {
    const keys = (style: (typeof NAVIGATION_STYLES)[number]) => new Set(ACTIONS.flatMap((a) => defaultBindings(style)[a]));
    for (const arrow of ["up", "down", "left", "right"]) {
      expect(keys("standard").has(arrow)).toBe(true);
      expect(keys("vim").has(arrow)).toBe(false);
      expect(keys("both").has(arrow)).toBe(true);
    }
    for (const letter of ["h", "j", "k", "l"]) {
      expect(keys("standard").has(letter)).toBe(false);
      expect(keys("vim").has(letter)).toBe(true);
      expect(keys("both").has(letter)).toBe(true);
    }
  });

  it("always includes the essentials in every style: select, back, quit, search, palette, help", () => {
    for (const style of NAVIGATION_STYLES) {
      const map = buildKeymap(style);
      expect(resolveKey(map, { key: "enter" })).toEqual({ action: "select" });
      expect(resolveKey(map, { key: "esc" })).toEqual({ action: "back" });
      expect(resolveKey(map, { key: "c", ctrl: true })).toEqual({ action: "quit" });
      expect(resolveKey(map, { key: "/" })).toEqual({ action: "search" });
      expect(resolveKey(map, { key: "p", ctrl: true })).toEqual({ action: "palette" });
      expect(resolveKey(map, { key: "?" })).toEqual({ action: "help" });
    }
  });
});

describe("overrides", () => {
  it("replace an action's default keys", () => {
    const map = buildKeymap("both", { palette: ["ctrl+k"] });
    expect(map.problems).toEqual([]);
    expect(resolveKey(map, { key: "k", ctrl: true })).toEqual({ action: "palette" });
    expect(resolveKey(map, { key: "p", ctrl: true })).toBeUndefined();
  });

  it("normalise their spelling", () => {
    const map = buildKeymap("both", { favorite: ["F"] });
    expect(map.byAction.favorite).toEqual(["shift+f"]);
  });

  it("report an invalid key and keep the action usable", () => {
    const map = buildKeymap("both", { palette: ["not-a-key"] });
    expect(map.problems.map((p) => p.kind)).toEqual(["invalid-chord", "empty"]);
    expect(resolveKey(map, { key: "p", ctrl: true })).toEqual({ action: "palette" });
  });

  it("refuse a key a default action already uses, and keep the other keys given", () => {
    const map = buildKeymap("both", { palette: ["ctrl+k", "j"] });
    expect(map.problems).toEqual([{ action: "palette", chord: "j", kind: "conflict", message: expect.stringContaining("down") }]);
    expect(resolveKey(map, { key: "j" })).toEqual({ action: "down" });
    expect(resolveKey(map, { key: "k", ctrl: true })).toEqual({ action: "palette" });
  });

  it("fall back to the defaults when every key given is refused", () => {
    const map = buildKeymap("both", { search: ["j"] });
    expect(map.problems.map((p) => p.kind).sort()).toEqual(["conflict", "empty"]);
    expect(resolveKey(map, { key: "/" })).toEqual({ action: "search" });
  });

  it("take the key away from both actions when two overrides want it", () => {
    const map = buildKeymap("both", { palette: ["ctrl+k"], search: ["ctrl+k"] });
    expect(resolveKey(map, { key: "k", ctrl: true })).toBeUndefined();
    expect(resolveKey(map, { key: "p", ctrl: true })).toEqual({ action: "palette" });
    expect(resolveKey(map, { key: "/" })).toEqual({ action: "search" });
    expect(map.problems.filter((p) => p.kind === "conflict")).toHaveLength(2);
  });

  it("let a swap work: two overrides that exchange each other's defaults", () => {
    const map = buildKeymap("standard", { palette: ["?"], help: ["ctrl+p"] });
    expect(resolveKey(map, { key: "?" })).toEqual({ action: "palette" });
    expect(resolveKey(map, { key: "p", ctrl: true })).toEqual({ action: "help" });
  });

  it("never let Ctrl+C or Esc be taken away, so a person can always leave", () => {
    const moved = buildKeymap("both", { quit: ["x"], back: ["b"] });
    expect(resolveKey(moved, { key: "c", ctrl: true })).toEqual({ action: "quit" });
    expect(resolveKey(moved, { key: "esc" })).toEqual({ action: "back" });
    expect(resolveKey(moved, { key: "x" })).toEqual({ action: "quit" });

    const stolen = buildKeymap("both", { search: ["ctrl+c"], palette: ["esc"] });
    expect(stolen.problems.filter((p) => p.kind === "reserved")).toHaveLength(2);
    expect(resolveKey(stolen, { key: "c", ctrl: true })).toEqual({ action: "quit" });
    expect(resolveKey(stolen, { key: "esc" })).toEqual({ action: "back" });
  });

  it("never throw and never leave a key doing two things, whatever is supplied", () => {
    const pool = ["j", "k", "ctrl+c", "esc", "enter", "ctrl+p", "x", "X", "", "??", "shift+tab", "f5", "1", "/"];
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let round = 0; round < 300; round++) {
      const overrides: Partial<Record<Action, string[]>> = {};
      for (const action of ACTIONS) {
        if (next() % 3 === 0) overrides[action] = Array.from({ length: (next() % 3) + 1 }, () => pool[next() % pool.length] ?? "x");
      }
      const style = NAVIGATION_STYLES[next() % NAVIGATION_STYLES.length] ?? "both";
      const map = buildKeymap(style, overrides);
      const all = ACTIONS.flatMap((a) => map.byAction[a]);
      expect(new Set(all).size, JSON.stringify(overrides)).toBe(all.length);
      for (const action of ACTIONS) expect(map.byAction[action].length, `${action} ${JSON.stringify(overrides)}`).toBeGreaterThan(0);
      expect(map.bindings.get("ctrl+c")).toBe("quit");
      expect(map.bindings.get("esc")).toBe("back");
    }
  });
});

describe("resolveKey and numbered selection", () => {
  const map = buildKeymap("both");
  it("resolves arrows and Vim keys to the same action", () => {
    expect(resolveKey(map, { key: "up" })).toEqual({ action: "up" });
    expect(resolveKey(map, { key: "k" })).toEqual({ action: "up" });
    expect(resolveKey(map, { key: "G" })).toEqual({ action: "bottom" });
  });
  it("jumps by digit only when numbered selection is on", () => {
    expect(resolveKey(map, { key: "3" })).toBeUndefined();
    expect(resolveKey(map, { key: "3" }, { numbered: true })).toEqual({ action: "jump", index: 2 });
    expect(resolveKey(map, { key: "9" }, { numbered: true })).toEqual({ action: "jump", index: 8 });
    expect(resolveKey(map, { key: "0" }, { numbered: true })).toBeUndefined();
    expect(resolveKey(map, { key: "3", ctrl: true }, { numbered: true })).toBeUndefined();
  });
  it("lets a digit the person bound win over the numbered jump", () => {
    const bound = buildKeymap("both", { favorite: ["1"] });
    expect(resolveKey(bound, { key: "1" }, { numbered: true })).toEqual({ action: "favorite" });
  });
  it("ignores unknown keys", () => {
    expect(resolveKey(map, { key: "Dead" })).toBeUndefined();
    expect(resolveKey(map, { key: "z" })).toBeUndefined();
  });
});

describe("chordLabel", () => {
  it.each([
    ["ctrl+p", "Ctrl+P"],
    ["j", "j"],
    ["shift+g", "G"],
    ["shift+tab", "Shift+Tab"],
    ["ctrl+shift+p", "Ctrl+Shift+P"],
    ["pagedown", "PgDn"],
    ["pageup", "PgUp"],
    ["f5", "F5"],
    ["enter", "Enter"],
    ["esc", "Esc"],
    ["/", "/"],
  ])("%s reads as %s", (chord, label) => {
    expect(chordLabel(chord)).toBe(label);
  });
});

describe("the ui section of the configuration", () => {
  it("defaults: dark JPE theme, everything auto, both navigation styles, no overrides", () => {
    expect(uiSettingsSchema.parse({})).toEqual({ theme: "jpe", color: "auto", unicode: "auto", density: "auto", motion: "auto", screenReader: false, navigation: "both", shortcuts: {} });
  });

  it("is optional: a configuration written before the ui section existed still loads, with defaults", () => {
    const old = { schemaVersion: 1, explanation: { depth: "brief" } };
    const parsed = configSchema.parse(old);
    expect(parsed.ui.theme).toBe("jpe");
    expect(parsed.explanation.depth).toBe("brief");
  });

  it("accepts valid shortcuts", () => {
    const parsed = uiSettingsSchema.parse({ shortcuts: { palette: ["ctrl+k"], favorite: ["F", "f"] } });
    expect(parsed.shortcuts.palette).toEqual(["ctrl+k"]);
  });

  it.each([
    ["an unknown action", { shortcuts: { teleport: ["x"] } }],
    ["an invalid key", { shortcuts: { palette: ["ctrl+"] } }],
    ["an empty key list", { shortcuts: { palette: [] } }],
    ["more than four keys", { shortcuts: { palette: ["a", "b", "c", "d", "e"] } }],
    ["an unknown theme", { theme: "neon" }],
    ["an unknown colour mode", { color: "rainbow" }],
    ["an unknown setting", { sparkles: true }],
  ])("rejects %s", (_name, input) => {
    expect(uiSettingsSchema.safeParse(input).success).toBe(false);
  });
});

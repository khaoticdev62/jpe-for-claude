import { describe, expect, it } from "vitest";
import { contrastRatio, isHexColor, parseHex, relativeLuminance, toAnsi256 } from "../../src/ui/color.js";
import { ROLES, STATUS_ROLES, THEME_NAMES, THEMES, isThemeName, type Role } from "../../src/ui/tokens.js";

describe("colour maths", () => {
  it("parses #RRGGBB and rejects everything else", () => {
    expect(parseHex("#9B6DFF")).toEqual({ r: 155, g: 109, b: 255 });
    expect(parseHex("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    for (const bad of ["", "#fff", "9B6DFF", "#GGGGGG", "#12345", "#1234567", "red"]) {
      expect(isHexColor(bad), bad).toBe(false);
      expect(() => parseHex(bad), bad).toThrow(RangeError);
    }
  });

  it("matches the WCAG reference values", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 10);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    // A widely published pair: #767676 on white is the lightest grey that passes AA (4.54:1).
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 1);
  });

  it("maps colours to the nearest xterm-256 index", () => {
    expect(toAnsi256("#000000")).toBe(16);
    expect(toAnsi256("#FFFFFF")).toBe(231);
    expect(toAnsi256("#FF0000")).toBe(196);
    expect(toAnsi256("#00FF00")).toBe(46);
    expect(toAnsi256("#0000FF")).toBe(21);
    const grey = toAnsi256("#808080");
    expect(grey).toBeGreaterThanOrEqual(232);
    expect(grey).toBeLessThanOrEqual(255);
  });
});

describe("the locked JPE palette", () => {
  it("is exactly the design directive's tokens in the default theme", () => {
    const jpe = THEMES.jpe;
    expect(jpe.background).toBe("#121212");
    expect(jpe.surface).toBe("#292929");
    expect(jpe.colors.text).toBe("#F0F0F0");
    expect(jpe.colors.muted).toBe("#BDBDBD");
    expect(jpe.colors.heading).toBe("#FAFAFA");
    expect(jpe.colors.accent).toBe("#9B6DFF");
  });
});

describe("every theme", () => {
  it("is registered under its own name and defines every role", () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_NAMES].sort());
    for (const name of THEME_NAMES) {
      const theme = THEMES[name];
      expect(theme.name).toBe(name);
      expect(isThemeName(name)).toBe(true);
      expect(isHexColor(theme.background) && isHexColor(theme.surface), name).toBe(true);
      for (const role of ROLES) {
        expect(isHexColor(theme.colors[role]), `${name}.${role}`).toBe(true);
        const index = theme.ansi16[role];
        expect(Number.isInteger(index) && index >= 0 && index <= 15, `${name}.${role} ansi16`).toBe(true);
      }
    }
    expect(isThemeName("nope")).toBe(false);
  });

  it("gives every status its own colour, so statuses never share one", () => {
    for (const name of THEME_NAMES) {
      const colours = STATUS_ROLES.map((role) => THEMES[name].colors[role].toLowerCase());
      expect(new Set(colours).size, `${name} status colours`).toBe(STATUS_ROLES.length);
    }
  });
});

describe("contrast (WCAG), measured against each theme's own background and surface", () => {
  const textRoles: readonly Role[] = ["text", "muted", "heading", "accent", "success", "warning", "error", "info", "pending", "inactive", "border", "keyword", "string", "comment", "number"];

  it("jpe: every text role reaches 4.5:1 (AA) on the background", () => {
    for (const role of textRoles) {
      expect(contrastRatio(THEMES.jpe.colors[role], THEMES.jpe.background), role).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The locked brand accent #9B6DFF measures 4.17:1 on #292929. It is therefore reserved for bold headings, borders and
  // other large or non-text parts on a raised surface (3:1 is the WCAG minimum for those). Inactive and border are
  // de-emphasised on purpose and held to the same 3:1.
  const relaxedOnSurface: readonly Role[] = ["accent", "inactive", "border"];

  it.each(["jpe", "jpe-colorblind"] as const)("%s: on the raised surface everything reaches 4.5:1 except accent, inactive and border, which reach 3:1", (name) => {
    for (const role of textRoles) {
      const ratio = contrastRatio(THEMES[name].colors[role], THEMES[name].surface);
      expect(ratio, `${name} ${role} on surface`).toBeGreaterThanOrEqual(relaxedOnSurface.includes(role) ? 3 : 4.5);
    }
  });

  it("jpe-contrast: every role reaches 7:1 (AAA) on both the background and the surface", () => {
    for (const role of textRoles) {
      expect(contrastRatio(THEMES["jpe-contrast"].colors[role], THEMES["jpe-contrast"].background), `${role} on background`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(THEMES["jpe-contrast"].colors[role], THEMES["jpe-contrast"].surface), `${role} on surface`).toBeGreaterThanOrEqual(7);
    }
  });

  it("jpe-colorblind: every role reaches 4.5:1 on the background", () => {
    for (const role of textRoles) {
      expect(contrastRatio(THEMES["jpe-colorblind"].colors[role], THEMES["jpe-colorblind"].background), role).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("jpe-light: every role reaches 4.5:1 on both the background and the surface", () => {
    for (const role of textRoles) {
      expect(contrastRatio(THEMES["jpe-light"].colors[role], THEMES["jpe-light"].background), `${role} on background`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(THEMES["jpe-light"].colors[role], THEMES["jpe-light"].surface), `${role} on surface`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("colour-blind theme", () => {
  it("does not rely on a red/green pair: success is blue-dominant, warning is yellow, error is neither green nor red-only", () => {
    const { success, warning, error } = THEMES["jpe-colorblind"].colors;
    const s = parseHex(success);
    const w = parseHex(warning);
    const e = parseHex(error);
    expect(s.b).toBeGreaterThan(s.r);
    expect(s.b).toBeGreaterThan(s.g);
    expect(w.r).toBeGreaterThan(w.b);
    expect(w.g).toBeGreaterThan(w.b);
    expect(e.g).toBeLessThan(e.r);
    expect(e.b).toBeGreaterThan(e.g);
  });
});

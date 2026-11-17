import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { type Annotation, callout, codeBlock, fits, section, sideBySide } from "../../src/ui/code.js";
import { type Line, lineText, lineWidth, plain, span } from "../../src/ui/doc.js";
import { resolveProfile, type RenderProfile, type UiSettings } from "../../src/ui/profile.js";

const ESC = "\u001b";
const WIDTHS = [20, 24, 30, 40, 60, 79, 80, 100, 160];

function setup(width = 80, settings: Partial<UiSettings> = {}): RenderProfile {
  const caps = detectCapabilities({ env: { LANG: "en_US.UTF-8", COLORTERM: "truecolor" }, platform: "linux", isTTY: true, columns: width, rows: 40 });
  return resolveProfile(caps, { ...defaultConfig().ui, ...settings });
}
const VARIANTS: Array<[string, Partial<UiSettings>]> = [["unicode", {}], ["ascii", { unicode: "off" }], ["screen reader", { screenReader: true }]];
const text = (lines: readonly Line[]): string => lines.map(lineText).join("\n");

const CODE = 'const secret = "abc";\nfunction run(x) {\n  return x + 1; // add one\n}\n';

describe("codeBlock", () => {
  it("numbers the lines, right-aligned, with a gutter bar", () => {
    const out = text(codeBlock({ code: "a\nb\nc", language: "plain", startLine: 8 }, setup()));
    expect(out).toBe(" 8 │ a\n 9 │ b\n10 │ c");
  });
  it("starts the numbering where the excerpt starts in the file", () => {
    expect(text(codeBlock({ code: "x", language: "plain", startLine: 120 }, setup()))).toBe("120 │ x");
  });
  it("drops the trailing newline instead of drawing an empty last line", () => {
    expect(codeBlock({ code: CODE, language: "js" }, setup())).toHaveLength(4);
  });
  it("colours syntax with the theme's roles, and the text is still exactly the code", () => {
    const lines = codeBlock({ code: CODE, language: "js" }, setup());
    const roles = new Set(lines.flatMap((l) => l.map((s) => s.role)));
    for (const role of ["keyword", "string", "comment", "number"]) expect(roles.has(role as never), role).toBe(true);
    expect(lines.map(lineText).map((l) => l.replace(/^\s*\d+ . /, ""))).toEqual(CODE.trimEnd().split("\n"));
  });
  it("draws an annotation under its line with a glyph, the word for its level, and the full text", () => {
    const annotations: Annotation[] = [{ line: 1, level: "warning", text: "possible hard-coded secret" }, { line: 3, level: "info", text: "adds one" }];
    const out = text(codeBlock({ code: CODE, language: "js", annotations }, setup()));
    expect(out).toContain("1 │ const secret");
    expect(out).toMatch(/1 │ const secret = "abc";\n {4}▲ warning: possible hard-coded secret\n2 │ function run/);
    expect(out).toContain("◆ note: adds one");
  });
  it("uses ASCII glyphs without Unicode", () => {
    const out = text(codeBlock({ code: "x", language: "plain", annotations: [{ line: 1, level: "error", text: "bad" }] }, setup(80, { unicode: "off" })));
    expect(out).toBe("1 | x\n    x error: bad");
  });
  it("marks emphasised lines with a heavier bar, not only a colour", () => {
    const out = text(codeBlock({ code: "a\nb", language: "plain", marked: [2] }, setup()));
    expect(out).toBe("1 │ a\n2 ┃ b");
    expect(text(codeBlock({ code: "a\nb", language: "plain", marked: [2] }, setup(80, { unicode: "off" })))).toBe("1 | a\n2 > b");
  });
  it("shows a truncated line with an ellipsis, never cut silently", () => {
    const out = text(codeBlock({ code: "x".repeat(200), language: "plain", width: 30 }, setup()));
    expect(out.endsWith("…")).toBe(true);
    expect(lineWidth(codeBlock({ code: "x".repeat(200), language: "plain", width: 30 }, setup())[0] ?? [])).toBe(30);
  });
  it("summarises lines beyond the limit, and says how many annotations are hidden among them", () => {
    const code = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    const out = text(codeBlock({ code, language: "plain", maxLines: 3, annotations: [{ line: 2, level: "info", text: "shown" }, { line: 7, level: "warning", text: "hidden one" }, { line: 9, level: "error", text: "hidden two" }] }, setup()));
    expect(out).toContain("◆ note: shown");
    expect(out).not.toContain("hidden one");
    expect(out).toContain("… 7 more lines (2 annotations hidden)");
    expect(text(codeBlock({ code, language: "plain", maxLines: 9 }, setup()))).toContain("… 1 more line");
  });
  it("reads each annotation as a sentence with its line number for a screen reader, with no gutter bars or glyphs", () => {
    const out = text(codeBlock({ code: "a\nb", language: "plain", annotations: [{ line: 2, level: "warning", text: "careful" }] }, setup(80, { screenReader: true })));
    expect(out).toBe("1: a\n2: b\nNote on line 2 (warning: careful)");
    expect(out).not.toMatch(/[│▲]/);
  });
  it("strips escape sequences from code and annotation text", () => {
    const out = text(codeBlock({ code: `a${ESC}[31mb\u0007`, language: "plain", annotations: [{ line: 1, level: "info", text: `x${ESC}]0;t\u0007y` }] }, setup()));
    expect(out).not.toContain(ESC);
    expect(out).toContain("ab");
    expect(out).toContain("xy");
  });
  it("copes with an empty file and with annotations on lines that do not exist", () => {
    expect(() => codeBlock({ code: "", language: "js", annotations: [{ line: 50, level: "info", text: "x" }] }, setup())).not.toThrow();
    expect(codeBlock({ code: "", language: "js" }, setup())).toHaveLength(1);
  });
  it("never exceeds the width, in any mode, and never loses a word of an annotation", () => {
    const note = "this is a rather long annotation that must wrap onto several lines at narrow widths without losing a single word";
    for (const width of WIDTHS) {
      for (const [name, settings] of VARIANTS) {
        const lines = codeBlock({ code: CODE + "x".repeat(300), language: "js", annotations: [{ line: 2, level: "warning", text: note }], width }, setup(width, settings));
        expect(fits(lines, width), `${name} @${width}`).toBe(true);
        const flat = text(lines).replace(/\s+/g, " ").replace(/[▲!]|warning:|Note on line 2 \(|\)/g, "");
        for (const word of note.split(" ")) expect(flat, `${name} @${width}: ${word}`).toContain(word);
      }
    }
  });
});

describe("sideBySide", () => {
  const panel = (title: string, rows: string[]) => ({ title, render: (_width: number): Line[] => rows.map((r) => plain(r)) });
  it("puts two panels in columns, with titles, separated by a bar, every row exactly the width", () => {
    const lines = sideBySide({ left: panel("Code", ["a", "b", "c"]), right: panel("Notes", ["x"]) }, setup(80));
    expect(text(lines)).toContain("Code");
    expect(text(lines)).toContain("Notes");
    for (const line of lines) {
      expect(lineText(line)).toContain("│");
      expect(lineWidth(line)).toBeLessThanOrEqual(80);
    }
    expect(lines).toHaveLength(4);
  });
  it("draws each panel at its own width", () => {
    const widths: number[] = [];
    const record = (w: number): Line[] => {
      widths.push(w);
      return [];
    };
    sideBySide({ left: { title: "L", render: record }, right: { title: "R", render: record } }, setup(100));
    expect(widths[0]).toBeGreaterThan(widths[1] ?? 0);
    expect((widths[0] ?? 0) + (widths[1] ?? 0) + 3).toBe(100);
  });
  it("stacks the panels under 80 columns and for a screen reader", () => {
    for (const [width, settings] of [[79, {}], [40, {}], [120, { screenReader: true }]] as const) {
      const lines = sideBySide({ left: panel("Code", ["a"]), right: panel("Notes", ["x"]) }, setup(width, settings));
      expect(lines.map(lineText)).toEqual(["Code", "a", "", "Notes", "x"]);
    }
  });
  it("never exceeds the width, whatever the panels draw", () => {
    const wide = { title: "A very long panel title that goes on", render: (w: number): Line[] => [plain("y".repeat(w + 40)), [span("日本語".repeat(40))]] };
    for (const width of WIDTHS) for (const [name, settings] of VARIANTS) expect(fits(sideBySide({ left: wide, right: wide }, setup(width, settings)), width), `${name} @${width}`).toBe(true);
  });
});

describe("section", () => {
  const body = [plain("one"), plain("two")];
  it("shows its body when expanded, with a marker", () => {
    expect(text(section({ title: "Symbols", body, expanded: true }, setup()))).toBe("▾ Symbols\n  one\n  two");
    expect(text(section({ title: "Symbols", body, expanded: true }, setup(80, { unicode: "off" })))).toBe("v Symbols\n  one\n  two");
  });
  it("shows only the title and how many lines are hidden when collapsed", () => {
    expect(text(section({ title: "Symbols", body, expanded: false }, setup()))).toBe("▸ Symbols (2 lines)");
    expect(text(section({ title: "Symbols", body: [plain("one")], expanded: false }, setup(80, { unicode: "off" })))).toBe("> Symbols (1 line)");
  });
  it("says expanded or collapsed in words for a screen reader", () => {
    const sr = setup(80, { screenReader: true });
    expect(text(section({ title: "Symbols", body, expanded: true }, sr))).toBe("Symbols (expanded)\none\ntwo");
    expect(text(section({ title: "Symbols", body, expanded: false }, sr))).toBe("Symbols (collapsed, 2 lines hidden)");
  });
  it("never exceeds the width", () => {
    const long = [plain("z".repeat(300))];
    for (const width of WIDTHS) for (const expanded of [true, false]) expect(fits(section({ title: "T".repeat(100), body: long, expanded }, setup(width)), width)).toBe(true);
  });
});

describe("callout", () => {
  it("shows a glyph, the title and an indented explanation", () => {
    expect(text(callout({ level: "warning", title: "Check this", body: "It may be wrong." }, setup()))).toBe("▲ Check this\n  It may be wrong.");
  });
  it("spells the level in words for a screen reader, and wraps within the width", () => {
    expect(text(callout({ level: "error", title: "Broke" }, setup(80, { screenReader: true })))).toBe("Error: Broke");
    for (const width of WIDTHS) expect(fits(callout({ level: "info", title: "T".repeat(80), body: "w ".repeat(100) }, setup(width)), width)).toBe(true);
  });
  it("sanitises its text", () => {
    expect(text(callout({ level: "info", title: `a${ESC}[1m`, body: `b${ESC}]0;x\u0007` }, setup()))).not.toContain(ESC);
  });
});

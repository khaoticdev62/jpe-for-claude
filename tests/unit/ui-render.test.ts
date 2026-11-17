import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.js";
import { COMPLETION_STATUSES } from "../../src/core/status.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { ALL_STATUSES, bulletList, heading, keyHints, keyValues, panel, progressBar, roleForStatus, statusBadge, table, textLines, verificationBadge } from "../../src/ui/components.js";
import { fitLine, lineText, lineWidth, padLine, plain, span, type Line } from "../../src/ui/doc.js";
import { paint, paintLine } from "../../src/ui/paint.js";
import { buildPreview } from "../../src/ui/preview.js";
import { breakpointFor, resolveProfile, type RenderProfile, type UiSettings } from "../../src/ui/profile.js";
import { displayWidth } from "../../src/ui/text.js";

const ESC = "\u001b";

interface Setup {
  env?: Record<string, string>;
  isTTY?: boolean;
  width?: number;
  rows?: number;
  settings?: Partial<UiSettings>;
  surface?: "terminal" | "own";
}

function setup(over: Setup = {}): RenderProfile {
  const caps = detectCapabilities({ env: { LANG: "en_US.UTF-8", COLORTERM: "truecolor", ...over.env }, platform: "linux", isTTY: over.isTTY ?? true, columns: over.width ?? 80, rows: over.rows ?? 40 });
  return resolveProfile(caps, { ...defaultConfig().ui, ...over.settings }, over.surface === undefined ? {} : { surface: over.surface });
}

/** Every combination of the settings that change layout. */
const VARIANTS: ReadonlyArray<[string, Setup]> = [
  ["unicode", {}],
  ["ascii", { settings: { unicode: "off" } }],
  ["screen reader", { settings: { screenReader: true } }],
  ["compact", { settings: { density: "compact" } }],
  ["no colour", { env: { NO_COLOR: "1" } }],
];

const WIDTHS = [20, 24, 30, 40, 59, 60, 80, 99, 100, 120, 200];

const text = (lines: readonly Line[]): string => lines.map(lineText).join("\n");

describe("document helpers", () => {
  it("measure and pad lines by display width", () => {
    const line: Line = [span("日本"), span("ab", { role: "accent" })];
    expect(lineWidth(line)).toBe(6);
    expect(lineWidth(padLine(line, 10))).toBe(10);
    expect(padLine(line, 3)).toBe(line);
  });

  it("fitLine truncates across spans, keeps styles, and never exceeds the width", () => {
    const line: Line = [span("hello ", { role: "accent" }), span("beautiful world", { bold: true })];
    for (let width = 0; width <= 25; width++) {
      const fitted = fitLine(line, width);
      expect(lineWidth(fitted), `width ${width}`).toBeLessThanOrEqual(width);
    }
    const cut = fitLine(line, 10);
    expect(lineText(cut)).toBe("hello bea…");
    expect(cut[0]?.role).toBe("accent");
    expect(fitLine(line, 100)).toBe(line);
  });

  it("span omits unset style fields", () => {
    expect(span("x")).toEqual({ text: "x" });
    expect(span("x", { role: "accent", bold: true })).toEqual({ text: "x", role: "accent", bold: true });
    expect(plain("hi")).toEqual([{ text: "hi" }]);
  });
});

describe("paint", () => {
  it("emits no escape sequences at all when output is piped", () => {
    const profile = setup({ isTTY: false });
    const out = paint([[span("ok", { role: "success", bold: true })], [span("dim", { role: "muted" })]], profile);
    expect(out).toBe("ok\ndim");
    expect(out).not.toContain(ESC);
  });

  it("paints truecolor, 256-colour and 16-colour from the same theme", () => {
    const line: Line = [span("x", { role: "accent" })];
    expect(paintLine(line, setup({ settings: { color: "truecolor" } }))).toBe(`${ESC}[38;2;155;109;255mx${ESC}[0m`);
    expect(paintLine(line, setup({ settings: { color: "256" } }))).toMatch(new RegExp(`^${ESC}\\[38;5;\\d+mx${ESC}\\[0m$`));
    expect(paintLine(line, setup({ settings: { color: "16" } }))).toBe(`${ESC}[95mx${ESC}[0m`);
    expect(paintLine([span("x", { role: "error" })], setup({ settings: { color: "16" } }))).toBe(`${ESC}[91mx${ESC}[0m`);
    expect(paintLine([span("x", { role: "pending" })], setup({ settings: { color: "16", theme: "jpe-light" } }))).toBe(`${ESC}[36mx${ESC}[0m`);
  });

  it("keeps bold, dim and underline when colour is off (NO_COLOR forbids colour, not emphasis)", () => {
    const profile = setup({ env: { NO_COLOR: "1" } });
    expect(profile.color).toBe("none");
    const out = paintLine([span("x", { role: "success", bold: true, underline: true })], profile);
    expect(out).toBe(`${ESC}[1;4mx${ESC}[0m`);
    expect(out).not.toMatch(/38;/);
  });

  it("leaves ordinary text in the terminal's own colour and dims secondary text, so any background stays readable", () => {
    const profile = setup();
    expect(paintLine([span("plain")], profile)).toBe("plain");
    expect(paintLine([span("quiet", { role: "muted" })], profile)).toBe(`${ESC}[2mquiet${ESC}[0m`);
  });

  it("paints headings in the accent colour", () => {
    expect(paintLine([span("Title", { role: "heading", bold: true })], setup())).toBe(`${ESC}[1;38;2;155;109;255mTitle${ESC}[0m`);
  });

  it("uses the theme's own text colours when JPE owns the surface (a pane)", () => {
    const profile = setup({ surface: "own" });
    expect(paintLine([span("t", { role: "text" })], profile)).toBe(`${ESC}[38;2;240;240;240mt${ESC}[0m`);
    expect(paintLine([span("m", { role: "muted" })], profile)).toBe(`${ESC}[38;2;189;189;189mm${ESC}[0m`);
  });

  it("strips escape sequences from span text, whatever built the span", () => {
    const profile = setup({ isTTY: false });
    const hostile = `${ESC}[2J${ESC}]0;pwned\u0007safe${ESC}[31m`;
    expect(paintLine([span(hostile)], profile)).toBe("safe");
    // With styling on, the only escapes in the output are the painter's own.
    const styled = paintLine([span(hostile, { role: "error" })], setup());
    expect(styled.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "")).toBe("safe");
  });

  it("never lets a span break the line structure", () => {
    expect(paintLine([span("a\nb\r\nc")], setup({ isTTY: false }))).toBe("a b c");
  });
});

describe("heading", () => {
  it("adds a blank line in comfortable density only", () => {
    expect(heading("Title", setup({ settings: { density: "comfortable" } }))).toHaveLength(2);
    expect(heading("Title", setup({ settings: { density: "compact" } }))).toHaveLength(1);
  });
  it("wraps a long title instead of cutting it off", () => {
    const profile = setup({ width: 30 });
    const lines = heading("A very long section title that cannot fit on one line", profile);
    for (const line of lines) expect(lineWidth(line)).toBeLessThanOrEqual(30);
    expect(text(lines).replaceAll(/\s+/g, " ").trim()).toBe("A very long section title that cannot fit on one line");
  });
});

describe("status badges: colour is never the only signal", () => {
  it("shows a glyph and the words", () => {
    const profile = setup();
    expect(text(statusBadge("success", "all good", profile))).toBe("✔ all good");
    expect(text(statusBadge("error", "broke", profile))).toBe("✘ broke");
  });
  it("uses distinct glyph shapes per status, in both symbol sets", () => {
    for (const unicode of ["on", "off"] as const) {
      const profile = setup({ settings: { unicode } });
      const glyphs = (["success", "warning", "error", "info", "inactive", "pending"] as const).map((role) => profile.symbols.status[role]);
      expect(new Set(glyphs).size, unicode).toBe(6);
    }
  });
  it("uses ASCII glyphs when Unicode is off", () => {
    expect(text(statusBadge("warning", "careful", setup({ settings: { unicode: "off" } })))).toBe("! careful");
  });
  it("spells the status in words for screen readers, with no glyph", () => {
    const profile = setup({ settings: { screenReader: true } });
    expect(text(statusBadge("error", "broke", profile))).toBe("Error: broke");
    expect(text(verificationBadge("FAILED", profile))).toBe("Status: FAILED");
  });
  it("sanitises the label", () => {
    expect(text(statusBadge("info", `x${ESC}[31m\ny`, setup()))).toBe("◆ x y");
  });
});

describe("verification badges", () => {
  it("show every status word exactly as defined, in every symbol set", () => {
    expect([...ALL_STATUSES]).toEqual([...COMPLETION_STATUSES]);
    for (const [, variant] of VARIANTS) {
      const profile = setup(variant);
      for (const status of COMPLETION_STATUSES) expect(text(verificationBadge(status, profile))).toContain(status);
    }
  });
  it("map each status to the role a reader expects", () => {
    expect(roleForStatus("VERIFIED")).toBe("success");
    expect(roleForStatus("FUNCTIONAL_WITH_WARNINGS")).toBe("warning");
    expect(roleForStatus("PARTIALLY_VERIFIED")).toBe("warning");
    expect(roleForStatus("FAILED")).toBe("error");
    expect(roleForStatus("BLOCKED")).toBe("error");
    expect(roleForStatus("NOT_TESTED")).toBe("inactive");
  });
  it("wrap on a very narrow terminal without losing or altering a single character of the status word", () => {
    for (const width of [20, 24, 30]) {
      const profile = setup({ width });
      for (const status of COMPLETION_STATUSES) {
        const lines = verificationBadge(status, profile);
        for (const line of lines) expect(lineWidth(line), `${status} @${width}`).toBeLessThanOrEqual(width);
        expect(lines.map(lineText).join("").replace(/^[^A-Z]+/, ""), `${status} @${width}`).toBe(status);
      }
    }
  });
  it("never present NOT_TESTED or FAILED with a success glyph", () => {
    const profile = setup();
    expect(text(verificationBadge("NOT_TESTED", profile))).not.toContain("✔");
    expect(text(verificationBadge("FAILED", profile))).not.toContain("✔");
  });
});

describe("progressBar", () => {
  it("writes the percentage and fills in proportion", () => {
    const profile = setup();
    const line = text([progressBar({ ratio: 0.5, width: 40 }, profile)]);
    expect(line).toContain(" 50%");
    expect(line.match(/█/g)?.length).toBe(line.match(/░/g)?.length);
  });
  it("clamps out-of-range ratios and treats non-numbers as zero", () => {
    const profile = setup();
    expect(text([progressBar({ ratio: -3 }, profile)])).toContain("  0%");
    expect(text([progressBar({ ratio: 7 }, profile)])).toContain("100%");
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(text([progressBar({ ratio: bad }, profile)]), String(bad)).toMatch(/\b(0|100)%/);
    }
    expect(text([progressBar({ ratio: Number.NaN }, profile)])).toContain("  0%");
  });
  it("uses # and - in ASCII", () => {
    const line = text([progressBar({ ratio: 0.5, width: 30 }, setup({ settings: { unicode: "off" } }))]);
    expect(line).toMatch(/^#+-+ +50%$/);
  });
  it("is read as words for a screen reader", () => {
    expect(text([progressBar({ ratio: 0.456, label: "Checks" }, setup({ settings: { screenReader: true } }))])).toBe("Checks: 46 percent");
    expect(text([progressBar({ ratio: 1 }, setup({ settings: { screenReader: true } }))])).toBe("Progress: 100 percent");
  });
  it("never exceeds its width, with or without a long label, at any size", () => {
    for (const width of WIDTHS) {
      for (const [name, variant] of VARIANTS) {
        for (const label of [undefined, "Checks", "A really quite long label that goes on and on"]) {
          const profile = setup({ ...variant, width });
          const options = label === undefined ? { ratio: 0.37 } : { ratio: 0.37, label };
          const line = progressBar(options, profile);
          if (!profile.screenReader) expect(lineWidth(line), `${name} @${width} ${label}`).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});

describe("panel", () => {
  const body = (profile: RenderProfile): Line[] => [...textLines("A fairly long line of body text that needs wrapping to fit.", profile.width - 4), [span("日本語のテキスト")], plain("short")];

  it("draws a box whose every line is exactly the panel width", () => {
    for (const width of WIDTHS) {
      for (const unicode of ["on", "off"] as const) {
        const profile = setup({ width, settings: { unicode } });
        const lines = panel({ title: "A title", body: body(profile) }, profile);
        const expected = Math.max(12, Math.min(profile.width, width));
        for (const line of lines) expect(lineWidth(line), `${unicode} @${width}: ${lineText(line)}`).toBe(expected);
      }
    }
  });
  it("uses rounded corners in Unicode and plain ones in ASCII", () => {
    const u = lineText(panel({ title: "T", body: [plain("x")] }, setup())[0] ?? []);
    expect(u.startsWith("╭") && u.endsWith("╮")).toBe(true);
    const a = lineText(panel({ title: "T", body: [plain("x")] }, setup({ settings: { unicode: "off" } }))[0] ?? []);
    expect(a.startsWith("+") && a.endsWith("+")).toBe(true);
  });
  it("truncates a line that is too wide, and a title that is too wide", () => {
    const profile = setup({ width: 24 });
    const lines = panel({ title: "A title that is far too long for this panel", body: [plain("x".repeat(100))] }, profile);
    expect(text(lines)).toContain("…");
    for (const line of lines) expect(lineWidth(line)).toBe(24);
  });
  it("draws a plain rule when there is no title", () => {
    const lines = panel({ title: "", body: [plain("x")] }, setup({ width: 20 }));
    expect(lineText(lines[0] ?? [])).toBe(`╭${"─".repeat(18)}╮`);
  });
  it("honours a narrower requested width and never exceeds the terminal", () => {
    const profile = setup({ width: 40 });
    expect(lineWidth(panel({ title: "T", body: [plain("x")], width: 20 }, profile)[0] ?? [])).toBe(20);
    expect(lineWidth(panel({ title: "T", body: [plain("x")], width: 90 }, profile)[0] ?? [])).toBe(40);
  });
  it("drops the border for a screen reader and keeps a heading", () => {
    const profile = setup({ settings: { screenReader: true } });
    const out = text(panel({ title: "Results", body: [plain("one"), plain("two")] }, profile));
    expect(out).toContain("Results");
    expect(out).toContain("one");
    expect(out).not.toMatch(/[╭╮╰╯│─+|]/);
  });
  it("sanitises the title", () => {
    const out = text(panel({ title: `T${ESC}[31m`, body: [] }, setup()));
    expect(out).not.toContain(ESC);
  });
});

describe("table", () => {
  const columns = [{ header: "Name" }, { header: "Status" }, { header: "Notes", min: 8 }, { header: "Time", align: "right" as const, min: 4 }];
  const rows = [
    ["alpha", "passed", "everything went fine here", "1.2s"],
    ["日本語のチェック", "failed", "the second row has much longer notes than the first", "20.5s"],
    ["gamma", "", "short", ""],
  ];

  it("fits every width: rows never exceed it, and either the columns line up or each row becomes a block", () => {
    for (const width of WIDTHS) {
      for (const [name, variant] of VARIANTS) {
        const profile = setup({ ...variant, width });
        const lines = table({ columns, rows }, profile);
        for (const line of lines) expect(lineWidth(line), `${name} @${width}: ${lineText(line)}`).toBeLessThanOrEqual(width);
        const stacked = lines.some((l) => lineText(l).startsWith("Name: "));
        if (!stacked) {
          const widths = lines.slice(2).map(lineWidth);
          expect(new Set(widths).size, `${name} @${width} should be aligned`).toBe(1);
        }
      }
    }
  });
  it("aligns columns with a rule under the header when there is room", () => {
    const lines = table({ columns: [{ header: "A" }, { header: "B", align: "right" }], rows: [["x", "1"], ["yy", "22"]] }, setup());
    expect(lines.map(lineText)).toEqual(["A  │  B", "───────", "x  │  1", "yy │ 22"]);
  });
  it("squeezes wide cells with an ellipsis before it gives up on columns", () => {
    const lines = table({ columns: [{ header: "Name" }, { header: "Notes", min: 6 }], rows: [["a", "a very long note indeed that will not fit"]] }, setup({ width: 30 }));
    expect(lines.map(lineText).some((l) => l.includes("…"))).toBe(true);
    for (const line of lines) expect(lineWidth(line)).toBeLessThanOrEqual(30);
  });
  it("switches to stacked rows when columns cannot be squeezed enough, and when a screen reader is in use", () => {
    const stacked = text(table({ columns, rows }, setup({ width: 20 })));
    expect(stacked).toContain("Name: alpha");
    expect(stacked).toContain("Status: passed");
    const spoken = text(table({ columns, rows }, setup({ settings: { screenReader: true } })));
    expect(spoken).toContain("Name: alpha");
    expect(spoken).not.toMatch(/[│─|]/);
  });
  it("copes with no columns, no rows and short rows", () => {
    expect(table({ columns: [], rows: [["x"]] }, setup())).toEqual([]);
    expect(table({ columns: [{ header: "A" }], rows: [] }, setup()).map(lineText)).toEqual(["A", "─"]);
    expect(() => table({ columns: [{ header: "A" }, { header: "B" }], rows: [["only one"]] }, setup())).not.toThrow();
  });
  it("sanitises cells, so one cell cannot inject escape sequences or break the row", () => {
    const lines = table({ columns: [{ header: "A" }, { header: "B" }], rows: [[`x${ESC}[31m\nz`, `${ESC}]0;t\u0007ok`]] }, setup());
    const out = text(lines);
    expect(out).not.toContain(ESC);
    expect(out).toContain("x z");
    expect(lines).toHaveLength(3);
  });
});

describe("keyValues", () => {
  const pairs: Array<[string, string]> = [["Theme", "jpe"], ["Width", "80 columns"], ["A much longer key", "value"]];
  it("aligns values in one column, within the width, at any size", () => {
    for (const width of WIDTHS) {
      for (const [name, variant] of VARIANTS) {
        for (const line of keyValues(pairs, setup({ ...variant, width }))) expect(lineWidth(line), `${name} @${width}`).toBeLessThanOrEqual(width);
      }
    }
    const aligned = keyValues(pairs, setup()).map(lineText);
    expect(aligned[0]?.indexOf("jpe")).toBe(aligned[1]?.indexOf("80 columns"));
  });
  it("writes 'Key: value' when narrow or for a screen reader", () => {
    expect(text(keyValues([["Theme", "jpe"]], setup({ width: 30 })))).toBe("Theme: jpe");
    expect(text(keyValues([["Theme", "jpe"]], setup({ settings: { screenReader: true } })))).toBe("Theme: jpe");
  });
  it("sanitises keys and values", () => {
    expect(text(keyValues([[`k${ESC}[1m`, `v\n${ESC}]0;x\u0007w`]], setup()))).toBe("k  v w");
  });
});

describe("bulletList", () => {
  it("wraps with a hanging indent and stays within the width", () => {
    for (const width of WIDTHS) {
      const lines = bulletList(["one short", "a rather long item that has to wrap onto several lines at narrow widths"], setup({ width }));
      for (const line of lines) expect(lineWidth(line)).toBeLessThanOrEqual(Math.max(width, 10));
    }
    const lines = bulletList(["alpha beta gamma delta epsilon"], setup({ width: 20 })).map(lineText);
    expect(lines[0]?.startsWith("• ")).toBe(true);
    expect(lines[1]?.startsWith("  ")).toBe(true);
  });
  it("uses an ASCII bullet when Unicode is off", () => {
    expect(text(bulletList(["x"], setup({ settings: { unicode: "off" } })))).toBe("* x");
  });
});

describe("keyHints", () => {
  it("are built from the live keymap, so a custom shortcut shows up", () => {
    const profile = setup({ settings: { shortcuts: { palette: ["ctrl+k"] } } });
    const out = text(keyHints(["palette", "select"], profile));
    expect(out).toContain("Ctrl+K: commands");
    expect(out).not.toContain("Ctrl+P");
    expect(out).toContain("Enter: open");
  });
  it("wrap to the width", () => {
    for (const width of [20, 40, 80]) for (const line of keyHints(["up", "down", "select", "back", "search", "palette", "help", "quit"], setup({ width }))) expect(lineWidth(line)).toBeLessThanOrEqual(Math.max(width, 24));
  });
});

describe("profile", () => {
  it("breakpoints: narrow below 60, medium below 100, wide from 100", () => {
    expect(breakpointFor(59)).toBe("narrow");
    expect(breakpointFor(60)).toBe("medium");
    expect(breakpointFor(99)).toBe("medium");
    expect(breakpointFor(100)).toBe("wide");
  });
  it("explicit settings beat detection", () => {
    expect(setup({ settings: { color: "none" } }).color).toBe("none");
    expect(setup({ env: { NO_COLOR: "1" }, settings: { color: "truecolor" } }).color).toBe("truecolor");
    expect(setup({ env: { LANG: "C" }, settings: { unicode: "on" } }).unicode).toBe(true);
    expect(setup({ settings: { unicode: "off" } }).unicode).toBe(false);
    expect(setup({ env: { SSH_TTY: "x" }, settings: { motion: "full" } }).motion).toBe("full");
    expect(setup({ settings: { theme: "jpe-contrast" } }).theme.name).toBe("jpe-contrast");
  });
  it("picks density from the terminal size when set to auto", () => {
    expect(setup({ width: 120, rows: 40 }).density).toBe("comfortable");
    expect(setup({ width: 70, rows: 40 }).density).toBe("compact");
    expect(setup({ width: 120, rows: 20 }).density).toBe("compact");
    expect(setup({ width: 70, settings: { density: "comfortable" } }).density).toBe("comfortable");
  });
  it("reduces motion over SSH, in CI and when piped", () => {
    expect(setup().motion).toBe("full");
    expect(setup({ env: { SSH_CONNECTION: "a b c d" } }).motion).toBe("reduced");
    expect(setup({ env: { CI: "1" } }).motion).toBe("reduced");
    expect(setup({ isTTY: false }).motion).toBe("reduced");
  });
  it("turns screen-reader mode on from the setting or the environment", () => {
    expect(setup({ settings: { screenReader: true } }).screenReader).toBe(true);
    expect(setup({ env: { JPE_SCREEN_READER: "1" } }).screenReader).toBe(true);
    expect(setup().screenReader).toBe(false);
  });
  it("styles explicitly requested colour even when piped, but not by default", () => {
    expect(setup({ isTTY: false }).styles).toBe(false);
    expect(setup({ isTTY: false, settings: { color: "truecolor" } }).styles).toBe(true);
    expect(setup({ isTTY: false, settings: { color: "none" } }).styles).toBe(false);
  });
  it("clamps an overridden width", () => {
    const caps = detectCapabilities({ env: {}, platform: "linux", isTTY: true, columns: 80, rows: 24 });
    expect(resolveProfile(caps, defaultConfig().ui, { width: 5 }).width).toBe(20);
    expect(resolveProfile(caps, defaultConfig().ui, { width: 9999 }).width).toBe(500);
    expect(resolveProfile(caps, defaultConfig().ui, { width: 90.7 }).width).toBe(90);
  });
});

describe("the jpe ui preview screen", () => {
  it("never exceeds the terminal width, for any width and any combination of settings", () => {
    for (const width of WIDTHS) {
      for (const [name, variant] of VARIANTS) {
        for (const theme of ["jpe", "jpe-light", "jpe-contrast", "jpe-colorblind"] as const) {
          const profile = setup({ ...variant, width, settings: { ...variant.settings, theme } });
          const caps = detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: true, columns: width, rows: 40 });
          const lines = buildPreview(caps, profile);
          for (const line of lines) expect(displayWidth(lineText(line)), `${name} ${theme} @${width}: ${lineText(line)}`).toBeLessThanOrEqual(width);
        }
      }
    }
  });
  it("labels its sample data as example data, so it cannot be mistaken for real results", () => {
    const profile = setup();
    const caps = detectCapabilities({ env: {}, platform: "linux", isTTY: true, columns: 80, rows: 40 });
    const out = text(buildPreview(caps, profile));
    expect(out).toContain("example data only");
    expect(out).toContain("example-a");
    expect(out).not.toMatch(/typecheck|unit-test/);
  });
  it("lists every status word, the palette with measured contrast, and the detection reasons", () => {
    const caps = detectCapabilities({ env: { NO_COLOR: "1" }, platform: "linux", isTTY: true, columns: 80, rows: 40 });
    const out = text(buildPreview(caps, setup({ env: { NO_COLOR: "1" } })));
    for (const status of COMPLETION_STATUSES) expect(out).toContain(status);
    expect(out).toMatch(/accent\s+Sample text\s+#9B6DFF\s+5\.4:1/);
    expect(out).toContain("contrast measured on #121212");
    expect(out).toContain("NO_COLOR");
  });
});

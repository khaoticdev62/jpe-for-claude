import { describe, expect, it } from "vitest";
import { detectCapabilities, MAX_COLUMNS, MIN_COLUMNS, type TerminalInput } from "../../src/ui/capabilities.js";

const term = (over: Partial<TerminalInput> & { env?: Record<string, string | undefined> } = {}): TerminalInput => ({
  env: {},
  platform: "linux",
  isTTY: true,
  columns: 100,
  rows: 40,
  ...over,
});
const caps = (over: Partial<TerminalInput> & { env?: Record<string, string | undefined> } = {}) => detectCapabilities(term(over));

describe("colour depth", () => {
  it.each([
    ["NO_COLOR wins over everything", { NO_COLOR: "1", COLORTERM: "truecolor", FORCE_COLOR: "3" }, "none"],
    ["an empty NO_COLOR does not count (per the NO_COLOR convention)", { NO_COLOR: "", COLORTERM: "truecolor" }, "truecolor"],
    ["FORCE_COLOR=0 turns colour off", { FORCE_COLOR: "0", COLORTERM: "truecolor" }, "none"],
    ["FORCE_COLOR=1 is 16 colours", { FORCE_COLOR: "1" }, "16"],
    ["FORCE_COLOR=2 is 256 colours", { FORCE_COLOR: "2" }, "256"],
    ["FORCE_COLOR=3 is truecolor", { FORCE_COLOR: "3" }, "truecolor"],
    ["TERM=dumb has no colour", { TERM: "dumb", COLORTERM: "truecolor" }, "none"],
    ["COLORTERM=truecolor", { COLORTERM: "truecolor", TERM: "xterm" }, "truecolor"],
    ["COLORTERM=24bit", { COLORTERM: "24bit" }, "truecolor"],
    ["Windows Terminal", { WT_SESSION: "abc" }, "truecolor"],
    ["VS Code's terminal", { TERM_PROGRAM: "vscode" }, "truecolor"],
    ["TERM=xterm-256color", { TERM: "xterm-256color" }, "256"],
    ["TERM=xterm", { TERM: "xterm" }, "16"],
    ["TERM=screen", { TERM: "screen" }, "16"],
    ["an unknown terminal falls back to 16", {}, "16"],
  ] as const)("%s", (_name, env, expected) => {
    expect(caps({ env }).color).toBe(expected);
  });

  it("is off when output is piped, unless FORCE_COLOR says otherwise", () => {
    expect(caps({ isTTY: false, env: { COLORTERM: "truecolor" } }).color).toBe("none");
    expect(caps({ isTTY: false, env: { FORCE_COLOR: "2" } }).color).toBe("256");
  });

  it("assumes truecolor for a plain Windows console and says so", () => {
    const result = caps({ platform: "win32", env: {} });
    expect(result.color).toBe("truecolor");
    expect(result.reasons.join(" ")).toMatch(/Windows console/);
  });
});

describe("styles (bold, dim, underline)", () => {
  it("are allowed on a real terminal, not when piped, not on a dumb terminal", () => {
    expect(caps().styles).toBe(true);
    expect(caps({ isTTY: false }).styles).toBe(false);
    expect(caps({ env: { TERM: "dumb" } }).styles).toBe(false);
  });
  it("stay allowed with NO_COLOR, which forbids colour only", () => {
    const result = caps({ env: { NO_COLOR: "1" } });
    expect(result.color).toBe("none");
    expect(result.styles).toBe(true);
  });
  it("are forced on by FORCE_COLOR even when piped", () => {
    expect(caps({ isTTY: false, env: { FORCE_COLOR: "1" } }).styles).toBe(true);
  });
});

describe("Unicode", () => {
  it.each([
    ["a UTF-8 locale", { LANG: "en_US.UTF-8" }, "linux", true],
    ["UTF8 without the dash", { LC_ALL: "C.utf8" }, "linux", true],
    ["LC_ALL beats LANG", { LC_ALL: "C", LANG: "en_US.UTF-8" }, "linux", false],
    ["the C locale", { LANG: "C" }, "linux", false],
    ["POSIX locale", { LANG: "POSIX" }, "linux", false],
    ["the Linux console", { TERM: "linux", LANG: "en_US.UTF-8" }, "linux", false],
    ["a dumb terminal", { TERM: "dumb" }, "linux", false],
    ["JPE_ASCII=1 beats a UTF-8 locale", { JPE_ASCII: "1", LANG: "en_US.UTF-8" }, "linux", false],
    ["no locale on macOS or Linux is assumed Unicode", {}, "darwin", true],
    ["Windows Terminal", { WT_SESSION: "x" }, "win32", true],
    ["VS Code on Windows", { TERM_PROGRAM: "vscode" }, "win32", true],
    ["the legacy Windows console", {}, "win32", false],
  ] as const)("%s", (_name, env, platform, expected) => {
    expect(caps({ env, platform }).unicode).toBe(expected);
  });
});

describe("size", () => {
  it("reads the terminal first, then COLUMNS and LINES, then defaults to 80x24", () => {
    expect(caps({ columns: 132, rows: 50 })).toMatchObject({ columns: 132, rows: 50 });
    expect(caps({ columns: undefined, rows: undefined, env: { COLUMNS: "120", LINES: "30" } })).toMatchObject({ columns: 120, rows: 30 });
    expect(caps({ columns: undefined, rows: undefined })).toMatchObject({ columns: 80, rows: 24 });
  });
  it("clamps absurd sizes and ignores junk", () => {
    expect(caps({ columns: 3 }).columns).toBe(MIN_COLUMNS);
    expect(caps({ columns: 99_999 }).columns).toBe(MAX_COLUMNS);
    expect(caps({ columns: undefined, env: { COLUMNS: "abc" } }).columns).toBe(80);
    expect(caps({ columns: undefined, env: { COLUMNS: "-5" } }).columns).toBe(80);
    expect(caps({ columns: undefined, env: { COLUMNS: "0" } }).columns).toBe(80);
    expect(caps({ columns: 80.9 }).columns).toBe(80);
  });
});

describe("session kind", () => {
  it("detects SSH from any of its three variables", () => {
    for (const key of ["SSH_CONNECTION", "SSH_TTY", "SSH_CLIENT"]) expect(caps({ env: { [key]: "1.2.3.4 22" } }).remote, key).toBe(true);
    expect(caps().remote).toBe(false);
  });
  it("detects CI, and CI is never interactive", () => {
    expect(caps({ env: { CI: "true" } })).toMatchObject({ ci: true, interactive: false });
    expect(caps({ env: { CI: "false" } }).ci).toBe(false);
    expect(caps({ env: { CI: "0" } }).ci).toBe(false);
  });
  it("is interactive only on a real terminal", () => {
    expect(caps().interactive).toBe(true);
    expect(caps({ isTTY: false }).interactive).toBe(false);
    expect(caps({ env: { TERM: "dumb" } }).interactive).toBe(false);
  });
  it("reduces motion on SSH, in CI, when piped, or when asked; not on a local terminal", () => {
    expect(caps().reducedMotion).toBe(false);
    expect(caps({ env: { SSH_TTY: "/dev/pts/1" } }).reducedMotion).toBe(true);
    expect(caps({ env: { CI: "1" } }).reducedMotion).toBe(true);
    expect(caps({ isTTY: false }).reducedMotion).toBe(true);
    expect(caps({ env: { JPE_REDUCED_MOTION: "1" } }).reducedMotion).toBe(true);
    expect(caps({ env: { JPE_REDUCED_MOTION: "0" } }).reducedMotion).toBe(false);
  });
  it("turns the screen-reader layout on only when asked, and says it cannot detect one", () => {
    expect(caps().screenReader).toBe(false);
    expect(caps({ env: { JPE_SCREEN_READER: "1" } }).screenReader).toBe(true);
    expect(caps().reasons.join(" ")).toMatch(/cannot be detected automatically/);
  });
});

describe("explanations", () => {
  it("gives a plain-English reason for the colour, symbol and size decisions", () => {
    const reasons = caps({ env: { LANG: "en_US.UTF-8" } }).reasons;
    expect(reasons.length).toBeGreaterThanOrEqual(4);
    for (const reason of reasons) expect(reason).toMatch(/\.$/);
  });
  it("never throws, whatever the environment holds", () => {
    const odd = ["", " ", "\u0000", "💥", "a".repeat(5000), "0", "-1", "NaN"];
    for (const a of odd) {
      for (const b of odd) {
        expect(() => caps({ env: { TERM: a, LANG: b, COLUMNS: a, COLORTERM: b, NO_COLOR: a, FORCE_COLOR: b, CI: a, WT_SESSION: b } })).not.toThrow();
      }
    }
  });
});

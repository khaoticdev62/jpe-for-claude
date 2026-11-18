import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext, type TerminalFacts } from "../../src/cli/context.js";
import { COMMAND_NAMES, runCli } from "../../src/cli/main.js";
import { exportConfig, importConfig } from "../../src/config/portable.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { displayWidth, stripAnsi } from "../../src/ui/text.js";

const ESC = "\u001b";

let base = "";
let project = "";
let out: string[] = [];
let err: string[] = [];

interface Posing {
  tty?: TerminalFacts;
  env?: Record<string, string>;
  platform?: NodeJS.Platform;
}

function makeCtx({ tty = { isTTY: false, columns: undefined, rows: undefined }, env = {}, platform = "linux" }: Posing = {}): CliContext {
  return createContext({
    cwd: project,
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    pathEnv: { platform, env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), LANG: "en_US.UTF-8", ...env }, homedir: base },
    git: async () => ({ exitCode: 128, stdout: "" }),
    terminal: () => tty,
  });
}

const run = (argv: string[], posing?: Posing): Promise<number> => runCli(argv, makeCtx(posing));
const stdout = (): string => out.join("\n");
const stderr = (): string => err.join("\n");
const TTY: TerminalFacts = { isTTY: true, columns: 100, rows: 40 };

const writeConfig = async (config: unknown): Promise<void> => {
  await mkdir(path.join(base, "data"), { recursive: true });
  await writeFile(path.join(base, "data", "config.json"), JSON.stringify(config));
};

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-ui-"));
  project = path.join(base, "project");
  await mkdir(project);
  out = [];
  err = [];
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("jpe ui", () => {
  it("is registered and listed in help", async () => {
    expect(COMMAND_NAMES).toContain("ui");
    expect(await run(["help"])).toBe(0);
    expect(stdout()).toMatch(/ui \[preview\|keys\]/);
  });

  it("prints a plain-text screen with no escape sequences when output is piped", async () => {
    expect(await run(["ui"])).toBe(0);
    expect(stdout()).toContain("JPE terminal interface");
    expect(stdout()).toContain("Colour is off because output is not an interactive terminal");
    expect(stdout()).not.toContain(ESC);
  });

  it("paints in the accent colour on a truecolor terminal", async () => {
    expect(await run(["ui"], { tty: TTY, env: { COLORTERM: "truecolor" } })).toBe(0);
    expect(stdout()).toContain(`${ESC}[1;38;2;155;109;255mJPE terminal interface`);
  });

  it("uses no colour but keeps emphasis when NO_COLOR is set", async () => {
    expect(await run(["ui"], { tty: TTY, env: { NO_COLOR: "1", COLORTERM: "truecolor" } })).toBe(0);
    expect(stdout()).toContain(`${ESC}[1mJPE terminal interface`);
    expect(stdout()).not.toMatch(new RegExp(`${ESC}\\[[0-9;]*38;`));
  });

  it("falls back to ASCII symbols on a legacy Windows console", async () => {
    expect(await run(["ui"], { tty: TTY, platform: "win32", env: { LANG: "" } })).toBe(0);
    const text = stripAnsi(stdout());
    expect(text).toMatch(/Symbols\s+ASCII/);
    expect(text).not.toMatch(/[✔✘▲◆○…╭╮╰╯│─█░•]/);
  });

  it("never draws wider than the terminal", async () => {
    for (const columns of [20, 30, 40, 60, 80, 120]) {
      out = [];
      expect(await run(["ui"], { tty: { isTTY: true, columns, rows: 40 }, env: { COLORTERM: "truecolor" } })).toBe(0);
      for (const line of stdout().split("\n")) expect(displayWidth(stripAnsi(line)), `@${columns}: ${stripAnsi(line)}`).toBeLessThanOrEqual(columns);
    }
  });

  it("--width overrides the terminal and is validated", async () => {
    expect(await run(["ui", "--width", "40"], { tty: { isTTY: true, columns: 120, rows: 40 } })).toBe(0);
    for (const line of stdout().split("\n")) expect(displayWidth(stripAnsi(line))).toBeLessThanOrEqual(40);
    for (const bad of ["5", "9999", "abc", "-1", "40.5"]) {
      out = [];
      err = [];
      expect(await run(["ui", "--width", bad]), bad).toBe(1);
      expect(stderr()).toMatch(/--width must be a whole number from 20 to 500/);
    }
  });

  it("flags override the saved settings for one run, and are validated like the config file", async () => {
    expect(await run(["ui", "--json", "--theme", "jpe-contrast", "--unicode", "off", "--color", "256"])).toBe(0);
    expect(JSON.parse(stdout()).profile).toMatchObject({ theme: "jpe-contrast", unicode: false, color: "256" });

    out = [];
    err = [];
    expect(await run(["ui", "--theme", "neon"])).toBe(1);
    expect(stderr()).toMatch(/display settings are not valid/);
    expect(stderr()).toContain("theme");
  });

  it("reads the saved configuration, and a flag beats it", async () => {
    await writeConfig({ schemaVersion: 1, ui: { theme: "jpe-light", density: "compact" } });
    expect(await run(["ui", "--json"])).toBe(0);
    expect(JSON.parse(stdout()).profile).toMatchObject({ theme: "jpe-light", density: "compact" });
    out = [];
    expect(await run(["ui", "--json", "--theme", "jpe"])).toBe(0);
    expect(JSON.parse(stdout()).profile).toMatchObject({ theme: "jpe", density: "compact" });
  });

  it("is wired to `jpe config set`: a setting changed there changes the screen", async () => {
    expect(await run(["config", "set", "ui.theme", "jpe-colorblind"])).toBe(0);
    expect(await run(["config", "set", "ui.navigation", "vim"])).toBe(0);
    out = [];
    expect(await run(["ui", "--json"])).toBe(0);
    expect(JSON.parse(stdout()).profile.theme).toBe("jpe-colorblind");
    out = [];
    expect(await run(["ui"])).toBe(0);
    expect(stdout()).toMatch(/Navigation\s+k and j to move/);
  });

  it("--screen-reader gives linear, border-free output", async () => {
    expect(await run(["ui", "--screen-reader"], { tty: TTY })).toBe(0);
    expect(stdout()).toContain("Status: VERIFIED");
    expect(stdout()).toContain("percent");
    expect(stdout()).not.toMatch(/[╭╮╰╯│█░]/);
  });

  it("--json describes the decisions without leaking the environment", async () => {
    expect(await run(["ui", "--json"], { env: { CANARY_ONE: "canary-value-one-8431", CANARY_TWO: "canary-value-two-9072" } })).toBe(0);
    const text = stdout();
    expect(text).not.toContain("canary-value-one-8431");
    expect(text).not.toContain("canary-value-two-9072");
    const json = JSON.parse(text);
    expect(Object.keys(json).sort()).toEqual(["profile", "reasons", "shortcutProblems"]);
    expect(json.profile).toMatchObject({ theme: "jpe", color: "none", unicode: true, width: 80, layout: "medium" });
  });

  it("rejects an unknown view", async () => {
    expect(await run(["ui", "bogus"])).toBe(1);
    expect(stderr()).toMatch(/Unknown view "bogus"/);
  });
});

describe("jpe ui keys", () => {
  it("lists every action with its keys", async () => {
    expect(await run(["ui", "keys"])).toBe(0);
    expect(stdout()).toContain("Keyboard shortcuts");
    expect(stdout()).toMatch(/palette\s+│ Ctrl\+P/);
    expect(stdout()).toContain("Digits 1 to 9");
  });

  it("reports saved shortcuts that were refused, and why, without breaking", async () => {
    await writeConfig({ schemaVersion: 1, ui: { shortcuts: { search: ["j"], palette: ["ctrl+k"] } } });
    expect(await run(["ui", "keys"])).toBe(0);
    expect(stdout()).toContain("Shortcut settings that were ignored");
    expect(stdout()).toMatch(/search: j is already used by down/);
    expect(stdout()).toMatch(/palette\s+│ Ctrl\+K/);
    out = [];
    expect(await run(["ui", "keys", "--json"])).toBe(0);
    expect(JSON.parse(stdout()).problems.map((p: { kind: string }) => p.kind).sort()).toEqual(["conflict", "empty"]);
  });
});

describe("the ui section of the saved configuration", () => {
  it("is rejected by the loader when it holds an invalid shortcut", async () => {
    await writeConfig({ schemaVersion: 1, ui: { shortcuts: { palette: ["ctrl+"] } } });
    expect(await run(["ui"])).toBe(1);
    expect(stderr()).toMatch(/jpe:/);
  });

  it("survives export and import", () => {
    const config = defaultConfig();
    config.ui.theme = "jpe-contrast";
    config.ui.shortcuts = { palette: ["ctrl+k"] };
    const exported = exportConfig(config);
    expect(exported.json).toContain("jpe-contrast");
    expect(exported.json).toContain("ctrl+k");
    const imported = importConfig(exported.json);
    expect(imported.ui.theme).toBe("jpe-contrast");
    expect(imported.ui.shortcuts).toEqual({ palette: ["ctrl+k"] });
  });
});

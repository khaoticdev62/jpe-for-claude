import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";
import { applyPreset, describeSettings, effectiveValue, findPreset, formatValue, GROUP_TITLES, isSettingKey, PRESETS, type Preset, SUMMARIES, settingSources, unsetPath, validateLayer } from "../../src/config/catalog.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { configSchema } from "../../src/config/schema.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { lineWidth } from "../../src/ui/doc.js";
import { resolveProfile } from "../../src/ui/profile.js";
import { presetListView, presetPreviewView, settingDetailView, settingsView, type SettingRow } from "../../src/settings/views.js";

const need = (name: string): Preset => {
  const found = findPreset(name);
  if (found === undefined) throw new Error(`no preset ${name}`);
  return found;
};
const profile = (width: number, screenReader = false) => resolveProfile(detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false, columns: width, rows: 40 }), { ...defaultConfig().ui, screenReader });

describe("the settings catalog", () => {
  const settings = describeSettings();
  it("has a plain-English summary for every setting, and none for a setting that no longer exists", () => {
    expect(settings.map((s) => s.key).sort()).toEqual(Object.keys(SUMMARIES).sort());
    for (const s of settings) expect(s.summary.length, s.key).toBeGreaterThan(15);
  });
  it("covers every section of the schema with a group title", () => {
    for (const s of settings) expect(GROUP_TITLES[s.section], s.section).toBeDefined();
    expect(new Set(settings.map((s) => s.section))).toEqual(new Set(Object.keys(GROUP_TITLES)));
  });
  it("takes defaults from the real defaults", () => {
    const defaults = defaultConfig();
    for (const s of settings) expect(formatValue(s.default), s.key).toBe(formatValue(effectiveValue(defaults, s.key)));
    expect(settings.find((s) => s.key === "ui.theme")?.default).toBe("jpe");
  });
  it("describes allowed values from the schema", () => {
    const allowed = (key: string): string => settings.find((s) => s.key === key)?.allowed ?? "";
    expect(allowed("ui.theme")).toContain("jpe-contrast");
    expect(allowed("ui.screenReader")).toBe("true | false");
    expect(allowed("engineering.maxRepairAttempts")).toBe("whole number from 0 to 10");
    expect(allowed("docs.providers")).toContain("list of:");
    expect(allowed("ui.shortcuts")).toContain("set of:");
  });
  it("recognises real settings only", () => {
    expect(isSettingKey("ui.theme")).toBe(true);
    for (const bad of ["ui", "theme", "ui.nope", "__proto__.x", "ui.theme.x", ""]) expect(isSettingKey(bad), bad).toBe(false);
  });
  it("formats values for people", () => {
    expect(formatValue(true)).toBe("true");
    expect(formatValue("jpe")).toBe("jpe");
    expect(formatValue([])).toBe("none");
    expect(formatValue({})).toBe("none");
    expect(formatValue(["a", "b"])).toBe("a, b");
    expect(formatValue(5000)).toBe("5000");
  });
});

describe("where a value comes from", () => {
  it("nothing set means everything is a default", () => {
    expect(settingSources({})).toEqual({});
  });
  it("the project beats the global file, and the environment beats both", () => {
    const sources = settingSources({ global: { ui: { theme: "jpe-light", motion: "reduced" } }, project: { ui: { theme: "jpe-contrast" } }, environment: { runtime: { offline: true } } });
    expect(sources).toEqual({ "ui.theme": "project", "ui.motion": "global", "runtime.offline": "environment" });
  });
  it("ignores things that are not sections", () => {
    expect(settingSources({ global: { schemaVersion: 1, ui: "oops" } as never })).toEqual({});
  });
});

describe("unsetPath", () => {
  it("removes one setting and keeps the others", () => {
    expect(unsetPath({ ui: { theme: "jpe-light", motion: "reduced" } }, "ui.theme")).toEqual({ ui: { motion: "reduced" } });
  });
  it("drops a section that becomes empty and keeps other sections", () => {
    expect(unsetPath({ schemaVersion: 1, ui: { theme: "x" }, runtime: { offline: true } }, "ui.theme")).toEqual({ schemaVersion: 1, runtime: { offline: true } });
  });
  it("changes nothing when the setting is not set, and never changes its input", () => {
    const layer = { ui: { theme: "jpe-light" } };
    const copy = JSON.stringify(layer);
    expect(unsetPath(layer, "ui.motion")).toEqual(layer);
    expect(unsetPath(layer, "runtime.offline")).toEqual(layer);
    expect(unsetPath(layer, "nonsense")).toEqual(layer);
    unsetPath(layer, "ui.theme");
    expect(JSON.stringify(layer)).toBe(copy);
  });
});

describe("presets", () => {
  it("have unique names and say what they do", () => {
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(p.summary.length, p.name).toBeGreaterThan(10);
  });
  it.each(PRESETS.map((p) => p.name))("%s only touches appearance settings, and produces a valid configuration", (name) => {
    const preset = findPreset(name);
    expect(preset).toBeDefined();
    if (preset === undefined) return;
    for (const key of [...Object.keys(preset.set), ...preset.unset]) {
      expect(key.startsWith("ui."), key).toBe(true);
      expect(isSettingKey(key), key).toBe(true);
      expect(key, key).not.toBe("ui.shortcuts");
    }
    for (const base of [{}, { ui: { theme: "jpe-light", shortcuts: { palette: ["ctrl+k"] } }, runtime: { offline: true } }]) {
      const out = applyPreset(base, preset);
      expect(validateLayer(out)).toBeUndefined();
      expect(configSchema.safeParse(JSON.parse(JSON.stringify({ ...out }))).success).toBe(true);
    }
  });
  it("the screen-reader preset turns on screen-reader mode", () => {
    const out = applyPreset({}, need("screen-reader")) as { ui: Record<string, unknown> };
    expect(out.ui).toMatchObject({ screenReader: true, color: "none", motion: "reduced" });
  });
  it("the default preset removes appearance settings but keeps key bindings and other sections", () => {
    const out = applyPreset({ ui: { theme: "jpe-contrast", motion: "reduced", shortcuts: { palette: ["ctrl+k"] } }, runtime: { offline: true } }, need("default"));
    expect(out).toEqual({ ui: { shortcuts: { palette: ["ctrl+k"] } }, runtime: { offline: true } });
  });
  it("does not change the layer it is given", () => {
    const layer = { ui: { theme: "jpe-light" } };
    const copy = JSON.stringify(layer);
    applyPreset(layer, need("high-contrast"));
    expect(JSON.stringify(layer)).toBe(copy);
  });
  it("validateLayer rejects a value the schema does not allow", () => {
    expect(validateLayer({ ui: { theme: "neon" } })).toContain("ui.theme");
    expect(validateLayer({ ui: { nope: 1 } })).toBeDefined();
  });
});

describe("the settings screens", () => {
  const rows: SettingRow[] = describeSettings().map((s, i) => ({ ...s, value: s.default, source: i % 5 === 0 ? "global" : "default" }));
  const first = rows[0] as SettingRow;
  const text = (lines: ReadonlyArray<ReadonlyArray<{ text: string }>>): string => lines.map((l) => l.map((s) => s.text).join("")).join("\n");
  it("groups settings and counts what changed", () => {
    const out = text(settingsView(rows, profile(100)));
    expect(out).toContain("Interface and accessibility");
    expect(out).toContain(`${rows.length} settings; ${rows.filter((r) => r.source !== "default").length} changed from the default`);
    expect(out).toContain("your setting");
  });
  it("says everything is at its default when nothing was changed", () => {
    expect(text(settingsView(rows.map((r) => ({ ...r, source: "default" as const })), profile(100)))).toContain("all at their defaults");
  });
  it("explains one setting completely", () => {
    const row: SettingRow = { ...(rows.find((r) => r.key === "ui.theme") as SettingRow), value: "jpe-contrast", source: "project" };
    const out = text(settingDetailView(row, profile(100)));
    for (const part of ["ui.theme", "jpe-contrast", "this project", "Default", "jpe-colorblind", "jpe config set ui.theme", "jpe settings unset ui.theme"]) expect(out, part).toContain(part);
  });
  it("a preview says nothing has changed, and a result says it was applied", () => {
    const preset = need("high-contrast");
    const changes = [{ key: "ui.theme", from: "jpe", to: "jpe-contrast", toDefault: false }];
    expect(text(presetPreviewView(preset, changes, false, false, "your settings", profile(100)))).toContain("Nothing has been changed");
    const done = text(presetPreviewView(preset, changes, true, true, "your settings", profile(100)));
    expect(done).toContain("Applied to your settings");
    expect(done).toContain("kept as a backup");
    expect(text(presetPreviewView(preset, changes, true, false, "your settings", profile(100)))).not.toContain("backup");
  });
  it("says so when a preset would change nothing", () => {
    const preset = need("high-contrast");
    expect(text(presetPreviewView(preset, [{ key: "ui.theme", from: "jpe-contrast", to: "jpe-contrast", toDefault: false }], false, false, "your settings", profile(100)))).toContain("Nothing would change");
  });
  it("shows a preset that returns settings to the default as such", () => {
    const preset = need("default");
    expect(text(presetPreviewView(preset, [{ key: "ui.theme", from: "jpe-light", to: "jpe", toDefault: true }], false, false, "your settings", profile(100)))).toContain("jpe (default)");
  });
  it.each([20, 40, 60, 80, 120, 200])("never overflows at %i columns", (width) => {
    const preset = need("screen-reader");
    const changes = [{ key: "ui.screenReader", from: false, to: true, toDefault: false }];
    for (const sr of [false, true]) {
      const p = profile(width, sr);
      for (const line of [...settingsView(rows, p), ...settingDetailView(first, p), ...presetListView(PRESETS, p), ...presetPreviewView(preset, changes, false, false, "your settings", p)]) expect(lineWidth(line), `${width} ${sr}`).toBeLessThanOrEqual(width);
    }
  });
});

describe("the settings command", () => {
  let base = "";
  let project = "";
  let envVars: Record<string, string | undefined> = {};
  const out: string[] = [];
  const errs: string[] = [];
  const makeCtx = (): CliContext =>
    createContext({
      cwd: project,
      out: (t) => void out.push(t),
      err: (t) => void errs.push(t),
      pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), PATH: "", ...envVars }, homedir: base },
      git: async () => ({ exitCode: 128, stdout: "" }),
      terminal: () => ({ isTTY: false, columns: undefined, rows: undefined }),
    });
  const globalFile = (): string => path.join(base, "data", "config.json");
  const projectFile = (): string => path.join(project, ".jpe", "config.json");
  const run = (...argv: string[]): Promise<number> => runCli(argv, makeCtx());
  const json = async <T>(...argv: string[]): Promise<T> => {
    out.length = 0;
    expect(await run(...argv, "--json")).toBe(0);
    return JSON.parse(out.join("\n"));
  };
  const exists = async (file: string): Promise<boolean> => readFile(file, "utf8").then(() => true, () => false);
  const backups = async (): Promise<string[]> => (await readdir(path.join(base, "data")).catch(() => [] as string[])).filter((n) => n.includes(".bak-"));

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "jpe-settings-"));
    project = path.join(base, "proj");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "package.json"), "{}");
    envVars = {};
    out.length = 0;
    errs.length = 0;
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("lists every setting with its source, as text and as JSON", async () => {
    expect(await run("settings", "--width", "100")).toBe(0);
    expect(out.join("\n")).toContain("all at their defaults");
    const rows = await json<SettingRow[]>("settings");
    expect(rows).toHaveLength(describeSettings().length);
    expect(rows.every((r: SettingRow) => r.source === "default")).toBe(true);
  });

  it("attributes each value to the layer it really comes from", async () => {
    await mkdir(path.dirname(globalFile()), { recursive: true });
    await writeFile(globalFile(), JSON.stringify({ schemaVersion: 1, ui: { theme: "jpe-light", motion: "reduced" } }));
    await mkdir(path.dirname(projectFile()), { recursive: true });
    await writeFile(projectFile(), JSON.stringify({ schemaVersion: 1, ui: { theme: "jpe-contrast" } }));
    envVars = { JPE_OFFLINE: "1" };
    const by = Object.fromEntries((await json<SettingRow[]>("settings")).map((r: SettingRow) => [r.key, r]));
    expect(by["ui.theme"]).toMatchObject({ value: "jpe-contrast", source: "project" });
    expect(by["ui.motion"]).toMatchObject({ value: "reduced", source: "global" });
    expect(by["runtime.offline"]).toMatchObject({ value: true, source: "environment" });
    expect(by["ui.density"]).toMatchObject({ source: "default" });
  });

  it("explains one setting", async () => {
    expect(await run("settings", "ui.motion", "--width", "100")).toBe(0);
    expect(out.join("\n")).toContain("auto | full | reduced");
    expect((await json<SettingRow>("settings", "ui.motion")).key).toBe("ui.motion");
  });

  it("unset removes the setting from the chosen file only, keeping a backup", async () => {
    await mkdir(path.dirname(globalFile()), { recursive: true });
    await writeFile(globalFile(), JSON.stringify({ schemaVersion: 1, ui: { theme: "jpe-light", motion: "reduced" } }));
    await mkdir(path.dirname(projectFile()), { recursive: true });
    await writeFile(projectFile(), JSON.stringify({ schemaVersion: 1, ui: { theme: "jpe-contrast" } }));
    expect(await run("settings", "unset", "ui.theme", "--project")).toBe(0);
    expect(JSON.parse(await readFile(projectFile(), "utf8"))).toEqual({ schemaVersion: 1 });
    expect(JSON.parse(await readFile(globalFile(), "utf8")).ui.theme).toBe("jpe-light");
    expect((await json<SettingRow[]>("settings")).find((r: SettingRow) => r.key === "ui.theme")).toMatchObject({ value: "jpe-light", source: "global" });
    expect(await run("settings", "unset", "ui.motion")).toBe(0);
    expect(await backups()).toHaveLength(1);
  });

  it("unset of a setting that is not set changes nothing and says so", async () => {
    expect(await run("settings", "unset", "ui.theme")).toBe(0);
    expect(out.join("\n")).toContain("nothing to remove");
    expect(await exists(globalFile())).toBe(false);
  });

  it("refuses an unknown setting, an unknown preset and an unknown command, changing nothing", async () => {
    expect(await run("settings", "unset", "ui.nope")).not.toBe(0);
    expect(await run("settings", "unset")).not.toBe(0);
    expect(await run("settings", "preset", "neon")).not.toBe(0);
    expect(await run("settings", "bogus")).not.toBe(0);
    expect(await exists(globalFile())).toBe(false);
  });

  it("a preset without --apply shows the change and writes nothing", async () => {
    expect(await run("settings", "preset", "screen-reader", "--width", "100")).toBe(0);
    expect(out.join("\n")).toContain("Nothing has been changed");
    expect(await exists(globalFile())).toBe(false);
  });

  it("a preset with --apply writes a valid file, and the settings then really take effect", async () => {
    expect(await run("settings", "preset", "screen-reader", "--apply")).toBe(0);
    expect(JSON.parse(await readFile(globalFile(), "utf8"))).toMatchObject({ schemaVersion: 1, ui: { screenReader: true, color: "none", motion: "reduced" } });
    expect(await backups()).toHaveLength(0);
    const by = Object.fromEntries((await json<SettingRow[]>("settings")).map((r: SettingRow) => [r.key, r]));
    expect(by["ui.screenReader"]).toMatchObject({ value: true, source: "global" });
    // A second, different preset replaces the file and keeps a copy of the first.
    expect(await run("settings", "preset", "high-contrast", "--apply")).toBe(0);
    expect(await backups()).toHaveLength(1);
    expect(JSON.parse(await readFile(globalFile(), "utf8")).ui).toMatchObject({ screenReader: true, theme: "jpe-contrast" });
  });

  it("applying a preset that is already in effect writes nothing", async () => {
    await run("settings", "preset", "low-motion", "--apply");
    out.length = 0;
    await run("settings", "preset", "low-motion", "--apply");
    expect(out.join("\n")).toContain("Nothing would change");
    expect(await backups()).toHaveLength(0);
  });

  it("--project writes to the project file and leaves the global one alone", async () => {
    expect(await run("settings", "preset", "ascii", "--apply", "--project")).toBe(0);
    expect(JSON.parse(await readFile(projectFile(), "utf8")).ui.unicode).toBe("off");
    expect(await exists(globalFile())).toBe(false);
    expect((await json<SettingRow[]>("settings")).find((r: SettingRow) => r.key === "ui.unicode")).toMatchObject({ value: "off", source: "project" });
  });

  it("the default preset puts appearance back but keeps other settings", async () => {
    await mkdir(path.dirname(globalFile()), { recursive: true });
    await writeFile(globalFile(), JSON.stringify({ schemaVersion: 1, ui: { theme: "jpe-contrast", motion: "reduced" }, runtime: { logLevel: "debug" } }));
    expect(await run("settings", "preset", "default", "--apply")).toBe(0);
    expect(JSON.parse(await readFile(globalFile(), "utf8"))).toEqual({ schemaVersion: 1, runtime: { logLevel: "debug" } });
  });

  it("a damaged settings file is reported and left untouched", async () => {
    await mkdir(path.dirname(globalFile()), { recursive: true });
    await writeFile(globalFile(), "{ not json");
    expect(await run("settings", "preset", "ascii", "--apply")).not.toBe(0);
    expect(await readFile(globalFile(), "utf8")).toBe("{ not json");
    expect(await backups()).toHaveLength(0);
  });

  it("`jpe settings preset --json` lists the presets", async () => {
    expect((await json<Array<{ name: string }>>("settings", "preset")).map((p: { name: string }) => p.name)).toEqual(PRESETS.map((p) => p.name));
  });
});

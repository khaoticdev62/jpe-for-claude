import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.js";
import { deepMerge, loadConfig, type ConfigFs } from "../../src/config/load.js";
import { migrateConfig } from "../../src/config/migrate.js";
import { dataDir, globalConfigPath, projectConfigPath, type PathEnv } from "../../src/config/paths.js";
import { exportConfig, importConfig } from "../../src/config/portable.js";
import { JpeError } from "../../src/core/errors.js";

const winEnv: PathEnv = { platform: "win32", env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, homedir: "C:\\Users\\a" };
const fakeFs = (files: Record<string, string>): ConfigFs => ({ readText: async (p) => files[p] });

describe("defaults", () => {
  it("match the locked product configuration", () => {
    const c = defaultConfig();
    expect(c.explanation.depth).toBe("adaptive");
    expect(c.explanation.timing).toBe("before-and-after");
    expect(c.engineering.approval).toBe("risk-based");
    expect(c.engineering.maxRepairAttempts).toBe(3);
    expect(c.security.allowExternalUploads).toBe(false);
    expect(c.runtime.offline).toBe(false);
  });
});

describe("paths", () => {
  it("resolves per-OS data dirs", () => {
    expect(dataDir(winEnv)).toBe("C:\\Users\\a\\AppData\\Roaming\\jpe");
    expect(dataDir({ platform: "darwin", env: {}, homedir: "/Users/a" })).toBe("/Users/a/Library/Application Support/jpe");
    expect(dataDir({ platform: "linux", env: {}, homedir: "/home/a" })).toBe("/home/a/.local/share/jpe");
    expect(dataDir({ platform: "linux", env: { XDG_DATA_HOME: "/x" }, homedir: "/home/a" })).toBe("/x/jpe");
  });
  it("prefers CLAUDE_PLUGIN_DATA", () => {
    expect(dataDir({ platform: "linux", env: { CLAUDE_PLUGIN_DATA: "/p" }, homedir: "/h" })).toBe("/p");
  });
});

describe("migrate", () => {
  it("upgrades the v0 flat offline flag", () => {
    expect(migrateConfig({ offline: true })).toEqual({ runtime: { offline: true }, schemaVersion: 1 });
  });
  it("rejects newer versions, non-objects and bad versions", () => {
    expect(() => migrateConfig({ schemaVersion: 99 })).toThrow(JpeError);
    expect(() => migrateConfig([])).toThrow(JpeError);
    expect(() => migrateConfig({ schemaVersion: -1 })).toThrow(JpeError);
  });
});

describe("loadConfig", () => {
  const gPath = globalConfigPath(winEnv);
  it("returns defaults when no files exist", async () => {
    expect(await loadConfig({ fs: fakeFs({}), pathEnv: winEnv })).toEqual(defaultConfig());
  });
  it("applies precedence defaults < global < project < env", async () => {
    const files = {
      [gPath]: JSON.stringify({ runtime: { logLevel: "debug" }, engineering: { maxRepairAttempts: 5 } }),
      [projectConfigPath("/proj")]: JSON.stringify({ engineering: { maxRepairAttempts: 2 } }),
    };
    const pathEnv = { ...winEnv, env: { ...winEnv.env, JPE_OFFLINE: "1" } };
    const c = await loadConfig({ fs: fakeFs(files), pathEnv, projectRoot: "/proj" });
    expect(c.runtime.logLevel).toBe("debug");
    expect(c.engineering.maxRepairAttempts).toBe(2);
    expect(c.runtime.offline).toBe(true);
  });
  it("rejects malformed JSON, unknown keys and out-of-range values", async () => {
    await expect(loadConfig({ fs: fakeFs({ [gPath]: "{nope" }), pathEnv: winEnv })).rejects.toThrow(/not valid JSON/);
    await expect(loadConfig({ fs: fakeFs({ [gPath]: '{"bogus":1}' }), pathEnv: winEnv })).rejects.toThrow(/invalid/);
    const tooMany = '{"engineering":{"maxRepairAttempts":999}}';
    await expect(loadConfig({ fs: fakeFs({ [gPath]: tooMany }), pathEnv: winEnv })).rejects.toThrow(/invalid/);
  });
  it("rejects an invalid JPE_LOG_LEVEL env value", async () => {
    const pathEnv = { ...winEnv, env: { JPE_LOG_LEVEL: "loud" } };
    await expect(loadConfig({ fs: fakeFs({}), pathEnv })).rejects.toThrow(/invalid/);
  });
});

describe("deepMerge", () => {
  it("ignores prototype-pollution keys", () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>;
    const merged = deepMerge({}, evil);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(merged["a"]).toBe(1);
  });
});

describe("export/import", () => {
  it("round-trips a config", () => {
    const original = defaultConfig();
    original.engineering.maxRepairAttempts = 7;
    const { json, removed } = exportConfig(original);
    expect(removed).toEqual([]);
    expect(importConfig(json)).toEqual(original);
  });
  it("refuses imports that contain secrets", () => {
    const provider = { name: "x", baseUrl: "https://example.com", apiKey: "abc" };
    expect(() => importConfig(JSON.stringify({ docs: { additionalProviders: [provider] } }))).toThrow(/secret-looking/);
  });
  it("strips secret-looking keys on export", () => {
    const cfg = defaultConfig();
    (cfg as unknown as Record<string, unknown>)["apiKey"] = "abc";
    const { json, removed } = exportConfig(cfg);
    expect(json).not.toContain("abc");
    expect(removed).toEqual(["$.apiKey"]);
  });
  it("rejects non-https provider URLs and invalid JSON", () => {
    const http = { name: "x", baseUrl: "http://example.com" };
    expect(() => importConfig(JSON.stringify({ docs: { additionalProviders: [http] } }))).toThrow(JpeError);
    expect(() => importConfig("nope")).toThrow(JpeError);
  });
});

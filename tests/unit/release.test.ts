import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const built = ["cli.js", "hook.js", "mcp.js", "package.json"].every((f) => existsSync(path.join(ROOT, "dist", f)));
const read = (rel: string): Promise<string> => readFile(path.join(ROOT, rel), "utf8");
const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

describe("version consistency", () => {
  it("package.json, plugin.json, marketplace.json and the MCP server agree on the version", async () => {
    const pkg = JSON.parse(await read("package.json")).version as string;
    expect(JSON.parse(await read(".claude-plugin/plugin.json")).version).toBe(pkg);
    expect(JSON.parse(await read(".claude-plugin/marketplace.json")).plugins[0].version).toBe(pkg);
    expect((await import("../../src/mcp/server.js")).SERVER_VERSION).toBe(pkg);
    expect(await read("CHANGELOG.md")).toContain(`## [${pkg}]`);
  });

  it("the marketplace entry matches the plugin name and uses a relative source", async () => {
    const market = JSON.parse(await read(".claude-plugin/marketplace.json"));
    expect(market.name).toBe("jpe-marketplace");
    expect(market.owner.name).toBeTruthy();
    expect(market.plugins[0]).toMatchObject({ name: "jpe", source: "./" });
  });
});

describe("installer scripts", () => {
  const scripts = ["installer/install.sh", "installer/uninstall.sh", "installer/install.ps1", "installer/uninstall.ps1"];

  it("download nothing, never hand-edit Claude Code settings, and never auto-approve", async () => {
    for (const s of scripts) {
      const text = await read(s);
      expect(text, `${s} must not download`).not.toMatch(/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i);
      expect(text, `${s} must not write settings files`).not.toMatch(/settings(\.local)?\.json/);
      expect(text, `${s} must not skip permissions`).not.toMatch(/dangerously|bypassPermissions/i);
    }
  });

  it("support dry runs, confirmation, both scopes and checksum verification", async () => {
    const sh = await read("installer/install.sh");
    const ps = await read("installer/install.ps1");
    for (const [text, flags] of [[sh, ["--dry-run", "--yes", "--scope", "--update", "--alias", "--force-alias"]], [ps, ["$DryRun", "$Yes", "$Scope", "$Update", "$Alias", "$ForceAlias"]]] as const) {
      for (const flag of flags) expect(text).toContain(flag);
      expect(text).toContain("SHA256SUMS");
      expect(text).toMatch(/nothing was installed/);
      expect(text).toContain("jpe-alias v1");
    }
  });

  it("uninstallers keep data by default and only remove an alias carrying JPE's marker", async () => {
    for (const s of ["installer/uninstall.sh", "installer/uninstall.ps1"]) {
      const text = await read(s);
      expect(text).toContain("--keep-data");
      expect(text).toContain("jpe-alias v1");
      expect(text).toMatch(/left alone/);
    }
  });

  it("shell scripts parse (when a POSIX shell is available)", () => {
    for (const s of ["installer/install.sh", "installer/uninstall.sh"]) {
      try {
        execFileSync("sh", ["-n", path.join(ROOT, s)], { stdio: "pipe" });
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return; // no sh on this machine
        throw new Error(`${s} has a syntax error: ${String((error as { stderr?: Buffer }).stderr)}`);
      }
    }
  });
});

describe("alias skill", () => {
  it("is named jpe, cannot be started by the model, carries the ownership marker and handles a missing plugin", async () => {
    const text = await read("installer/alias/SKILL.md");
    expect(text).toMatch(/^---\nname: jpe\n/);
    expect(text).toContain("disable-model-invocation: true");
    expect(text).toContain("jpe-alias v1");
    expect(text).toContain("installed_plugins.json");
    expect(text).toMatch(/not installed/);
    expect(text).toMatch(/Do NOT guess/);
  });
});

describe.skipIf(!built)("release package", () => {
  let out = "";
  const run = (dir: string): string => execFileSync(process.execPath, [path.join(ROOT, "scripts", "package.mjs"), "--out", dir], { cwd: ROOT, encoding: "utf8" });

  beforeAll(async () => {
    out = await mkdtemp(path.join(tmpdir(), "jpe-release-"));
    run(path.join(out, "a"));
    run(path.join(out, "b"));
  }, 120_000);
  afterAll(async () => {
    await rm(out, { recursive: true, force: true });
  });

  it("is byte-for-byte reproducible and its published checksum is correct", async () => {
    const version = JSON.parse(await read("package.json")).version as string;
    const a = await readFile(path.join(out, "a", `jpe-${version}.zip`));
    const b = await readFile(path.join(out, "b", `jpe-${version}.zip`));
    expect(sha256(a)).toBe(sha256(b));
    expect(await readFile(path.join(out, "a", `jpe-${version}.zip.sha256`), "utf8")).toBe(`${sha256(a)}  jpe-${version}.zip\n`);
  });

  it("contains a complete, self-contained plugin and installers, with no source or dependencies", async () => {
    const version = JSON.parse(await read("package.json")).version as string;
    const dir = path.join(out, "a", `jpe-${version}`);
    const sums = (await readFile(path.join(dir, "SHA256SUMS"), "utf8")).trim().split("\n");
    const files = sums.map((l) => l.split("  ")[1] ?? "");
    const plugin = "jpe-marketplace/plugins/jpe/";
    for (const needed of [
      "jpe-marketplace/.claude-plugin/marketplace.json",
      `${plugin}.claude-plugin/plugin.json`,
      `${plugin}hooks/hooks.json`,
      `${plugin}dist/cli.js`,
      `${plugin}dist/hook.js`,
      `${plugin}dist/mcp.js`,
      `${plugin}dist/package.json`,
      `${plugin}skills/jpe/SKILL.md`,
      `${plugin}agents/jpe-verifier.md`,
      `${plugin}README.md`,
      "installer/install.sh",
      "installer/install.ps1",
      "installer/uninstall.sh",
      "installer/uninstall.ps1",
      "installer/alias/SKILL.md",
      "INSTALL.md",
      "LICENSE",
      "CHANGELOG.md",
    ]) {
      expect(files, needed).toContain(needed);
    }
    expect(files.some((f) => f.includes("node_modules") || f.includes("/src/") || f.endsWith(".ts") || f.includes(".env"))).toBe(false);
    expect(files.filter((f) => f.startsWith(`${plugin}skills/`))).toHaveLength(11);
    expect(files.filter((f) => f.startsWith(`${plugin}agents/`))).toHaveLength(7);

    // Every listed checksum is true, and the packaged marketplace points at the packaged plugin.
    for (const line of sums) {
      const [hash, rel] = line.split("  ");
      expect(sha256(await readFile(path.join(dir, rel ?? ""))), rel).toBe(hash);
    }
    const market = JSON.parse(await readFile(path.join(dir, "jpe-marketplace", ".claude-plugin", "marketplace.json"), "utf8"));
    expect(market.plugins[0].source).toBe("./plugins/jpe");
  });

  it("the packaged command line runs on its own, outside the repository", async () => {
    const version = JSON.parse(await read("package.json")).version as string;
    const cli = path.join(out, "a", `jpe-${version}`, "jpe-marketplace", "plugins", "jpe", "dist", "cli.js");
    const result = execFileSync(process.execPath, [cli, "help"], { cwd: out, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(result).toContain("Usage: jpe <command>");
  });
});

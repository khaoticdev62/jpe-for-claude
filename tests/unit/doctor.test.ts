import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/main.js";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { store } from "../../src/cli/commands/admin.js";
import { DocCache } from "../../src/docs/cache.js";
import { applyRepairs, exportDoctor, formatDoctor, runDoctor, sanitize } from "../../src/doctor/doctor.js";
import { mcpHandshake } from "../../src/doctor/plugin-checks.js";
import type { DoctorEnv, DoctorReport, Finding } from "../../src/doctor/types.js";
import { TOOLS } from "../../src/mcp/tools.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const built = existsSync(path.join(ROOT, "dist", "mcp.js")) && existsSync(path.join(ROOT, "dist", "hook.js")) && existsSync(path.join(ROOT, "dist", "cli.js"));

let base = "";
let project = "";
let out: string[] = [];
let err: string[] = [];

const ctxFor = (over: Partial<CliContext> = {}): CliContext =>
  createContext({
    cwd: project,
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    pathEnv: { platform: process.platform, env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), PATH: process.env["PATH"] ?? "" }, homedir: base },
    git: async () => ({ exitCode: 128, stdout: "" }),
    ...over,
  });
const envFor = (pluginRoot: string | undefined, over: Partial<CliContext> = {}, deep = false): DoctorEnv => ({ ctx: ctxFor({ ...over, pluginRoot }), pluginRoot, deep, nodeVersion: process.version });
const byId = (r: DoctorReport, id: string): Finding => {
  const hit = r.findings.find((x) => x.id === id);
  if (!hit) throw new Error(`no finding ${id}; have ${r.findings.map((x) => x.id).join(", ")}`);
  return hit;
};

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-doctor-"));
  project = path.join(base, "project");
  await mkdir(project);
  out = [];
  err = [];
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

describe.skipIf(!built)("a healthy installation", () => {
  it("passes every plugin check by really starting the MCP server and running a hook", async () => {
    const report = await runDoctor(envFor(ROOT));
    expect(report.overall === "ok" || report.overall === "warn").toBe(true);
    expect(report.findings.filter((x) => x.status === "fail")).toEqual([]);
    for (const id of ["manifest", "skills", "agents", "hooks-config", "hook-run", "mcp-start", "config", "storage"]) expect(byId(report, id).status, id).toBe("ok");
    expect(byId(report, "mcp-start").title).toContain(`${TOOLS.length} tools`);
    expect(byId(report, "agents").title).toContain("7 agents");
  }, 60_000);

  it("the CLI command prints a readable report and exits 0", async () => {
    const code = await runCli(["doctor"], ctxFor({ pluginRoot: ROOT }));
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("JPE Doctor:");
    expect(text).toContain("[OK  ] All 11 skills are present");
  }, 60_000);

  it("exports a shareable report with the home folder replaced and credentials redacted", async () => {
    const code = await runCli(["doctor", "--export", "report.json"], ctxFor({ pluginRoot: ROOT }));
    expect(code).toBe(0);
    const text = await readFile(path.join(project, "report.json"), "utf8");
    expect(JSON.parse(text).findings.length).toBeGreaterThan(5);
    const user = path.basename(os.homedir()).toLowerCase();
    expect(text.toLowerCase(), "the user name must not appear in a shareable report").not.toContain(user);
  }, 60_000);
});

describe("a damaged installation is reported precisely", () => {
  let plugin = "";
  beforeEach(async () => {
    plugin = path.join(base, "plugin");
    for (const dir of ["skills", "agents", "hooks", ".claude-plugin"]) await cp(path.join(ROOT, dir), path.join(plugin, dir), { recursive: true });
    await mkdir(path.join(plugin, "dist"));
    for (const f of ["cli.js", "hook.js"]) await writeFile(path.join(plugin, "dist", f), "process.exit(0);\n");
    await writeFile(path.join(plugin, "dist", "mcp.js"), "process.exit(0);\n"); // exits without answering
  });

  it("flags a server that exits, a missing skill, bad agent tool lists and hooks", async () => {
    await rm(path.join(plugin, "skills", "fix"), { recursive: true });
    const debuggerFile = path.join(plugin, "agents", "jpe-debugger.md");
    await writeFile(debuggerFile, (await readFile(debuggerFile, "utf8")).replace(/^tools: .*$/m, "tools: Read, Bash, Edit, mcp__plugin_jpe_jpe__no_such_tool"));
    await writeFile(path.join(plugin, "agents", "jpe-lsp.md"), "no front matter at all");
    await writeFile(path.join(plugin, "hooks", "hooks.json"), JSON.stringify({ hooks: { SessionStart: [] } }));
    await rm(path.join(plugin, "dist", "cli.js"));

    const report = await runDoctor(envFor(plugin));
    expect(report.overall).toBe("fail");
    expect(byId(report, "manifest").status).toBe("ok");
    expect(byId(report, "bundle-cli.js").status).toBe("fail");
    expect(byId(report, "skills").detail).toContain("fix: missing");
    expect(byId(report, "mcp-start").status).toBe("fail");
    expect(byId(report, "hooks-config").status).toBe("warn");
    const agents = byId(report, "agents");
    expect(agents.status).toBe("fail");
    expect(agents.detail).toContain("jpe-lsp: missing or no front matter");
    expect(agents.detail).toContain("jpe-debugger: has the powerful tool Bash");
    expect(agents.detail).toContain("jpe-debugger: has the powerful tool Edit");
    const formatted = formatDoctor(report);
    expect(formatted).toContain("problems found");
    expect(formatted).toContain("[FAIL]");
  });

  it("flags a broken manifest, which also hides the MCP declaration", async () => {
    await writeFile(path.join(plugin, ".claude-plugin", "plugin.json"), "{ nope");
    const report = await runDoctor(envFor(plugin));
    expect(byId(report, "manifest").title).toContain("not valid JSON");
    expect(byId(report, "mcp-config").status).toBe("fail");
  });

  it("warns, in plain words, when the command center interface is not registered, its file is missing, or its types contract is missing", async () => {
    await cp(path.join(ROOT, "types"), path.join(plugin, "types"), { recursive: true });
    const status = async (): Promise<string | undefined> => byId(await runDoctor(envFor(plugin)), "interface-module").status;
    expect(await status()).toBe("ok");

    await rm(path.join(plugin, "types"), { recursive: true });
    expect(await status()).toBe("warn");
    await cp(path.join(ROOT, "types"), path.join(plugin, "types"), { recursive: true });

    await rm(path.join(plugin, "hooks", "center.js"));
    const missing = byId(await runDoctor(envFor(plugin)), "interface-module");
    expect(missing.status).toBe("warn");
    expect(missing.title).toContain("text menu");

    await writeFile(path.join(plugin, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
    expect(byId(await runDoctor(envFor(plugin)), "interface-module").title).toContain("not registered");
  });

  it("reports a missing plugin folder instead of crashing", async () => {
    const report = await runDoctor(envFor(undefined));
    expect(byId(report, "plugin-root").status).toBe("fail");
  });

  it("the MCP handshake probe distinguishes a silent server, a missing file and a working one", async () => {
    expect((await mcpHandshake(path.join(plugin, "dist", "mcp.js"), project, 5000)).ok).toBe(false);
    expect((await mcpHandshake(path.join(plugin, "dist", "does-not-exist.js"), project, 5000)).ok).toBe(false);
    if (built) {
      const hs = await mcpHandshake(path.join(ROOT, "dist", "mcp.js"), project, 15_000);
      expect(hs).toMatchObject({ ok: true, serverName: "jpe" });
      expect(hs.tools).toEqual(expect.arrayContaining(TOOLS.map((t) => t.name)));
    }
  }, 60_000);
});

describe("environment checks and repairs", () => {
  const dataDir = (): string => path.join(base, "data");

  it("detects an invalid configuration with a pointer to the fix", async () => {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(path.join(dataDir(), "config.json"), JSON.stringify({ engineering: { maxRepairAttempts: 500 } }));
    const report = await runDoctor(envFor(undefined));
    expect(byId(report, "config").status).toBe("fail");
    expect(byId(report, "config").title).toContain("maxRepairAttempts");
  });

  it("finds damaged cache entries, never trusts them, and repairs only those", async () => {
    const cacheDir = path.join(dataDir(), "docs-cache");
    const cache = new DocCache({ dir: cacheDir, now: () => new Date(), ttlHours: 24 });
    const good = DocCache.key("p", "zod", "1.0.0", "a");
    const bad = DocCache.key("p", "zod", "1.0.0", "b");
    const draft = { provider: "p", kind: "reference" as const, title: "t", content: "hello", trust: "official" as const };
    await cache.put(good, [draft]);
    await cache.put(bad, [draft]);
    await writeFile(path.join(cacheDir, `${bad}.json`), (await readFile(path.join(cacheDir, `${bad}.json`), "utf8")).replace("hello", "poisoned"));
    await writeFile(path.join(cacheDir, `${good}.json.tmp-123`), "leftover");

    const env = envFor(undefined);
    const report = await runDoctor(env);
    const cacheFinding = byId(report, "cache");
    expect(cacheFinding.status).toBe("warn");
    expect(cacheFinding.title).toContain("2 documentation cache entries are damaged");
    expect(cacheFinding.repair).toBe("remove-corrupt-cache");

    const repaired = await applyRepairs(env, report);
    expect(repaired.repairs.map((r) => r.id)).toContain("remove-corrupt-cache");
    expect(await readdir(cacheDir)).toEqual([`${good}.json`]);
    expect(byId(await runDoctor(env), "cache").status).toBe("ok");
  });

  it("does not repair anything unless asked, and leaves healthy installs untouched", async () => {
    const report = await runDoctor(envFor(undefined));
    expect(report.repairs).toEqual([]);
    expect(await applyRepairs(envFor(undefined), report)).toMatchObject({ repairs: [] });
  });

  it("flags backups that fail their integrity check", async () => {
    await writeFile(path.join(project, "a.txt"), "original");
    const ctx = ctxFor();
    const b = await store(ctx).create(project, ["a.txt"], "t");
    expect(byId(await runDoctor({ ...envFor(undefined), ctx }), "backups").status).toBe("ok");
    await writeFile(path.join(ctx.stateDir(), "backups", b.id, "files", "0"), "tampered");
    expect(byId(await runDoctor({ ...envFor(undefined), ctx }), "backups").status).toBe("fail");
  });

  it("warns when credential files are tracked by git", async () => {
    const git = async (args: readonly string[]) => (args[0] === "ls-files" ? { exitCode: 0, stdout: "src/a.ts\0.env\0" } : { exitCode: 128, stdout: "" });
    const report = await runDoctor(envFor(undefined, { git }));
    expect(byId(report, "tracked-secrets").status).toBe("fail");
    expect(byId(report, "tracked-secrets").title).toContain(".env");
  });

  it("states honestly that online sources were not tested without --deep, and respects offline mode", async () => {
    expect(byId(await runDoctor(envFor(undefined)), "network").title).toContain("--deep");
    await mkdir(dataDir(), { recursive: true });
    await writeFile(path.join(dataDir(), "config.json"), JSON.stringify({ schemaVersion: 1, runtime: { offline: true } }));
    expect(byId(await runDoctor(envFor(undefined)), "network").title).toContain("Offline mode is on");
  });

  it("deep mode reports unreachable online sources as warnings, not failures", async () => {
    const net = { resolve: async () => ["93.184.216.34"], fetch: (async () => new Response("nope", { status: 503 })) as typeof fetch };
    const run = async () => ({ exitCode: 1, stdout: "", stderr: "", timedOut: false, truncated: false, durationMs: 1 });
    const report = await runDoctor(envFor(undefined, { net, run }, true));
    const net1 = report.findings.filter((x) => x.id.startsWith("net-"));
    expect(net1).toHaveLength(3);
    expect(net1.every((x) => x.status === "warn")).toBe(true);
  });
});

describe("report hygiene", () => {
  it("sanitize replaces the home folder and redacts credentials", () => {
    const home = os.homedir();
    const text = sanitize(`${home}/proj token=abcdef123456789 and sk-abcdefghijklmnop1234`);
    expect(text).not.toContain(home);
    expect(text).toContain("~/proj");
    expect(text).not.toContain("abcdef123456789");
    expect(text).not.toContain("sk-abcdefghijklmnop1234");
  });
  it("sanitizing a JSON export hides Windows-style paths even though JSON doubles backslashes", () => {
    const home = os.homedir();
    const report: DoctorReport = { generatedAt: "t", overall: "ok", findings: [{ id: "x", area: "A", status: "info", title: "t", detail: `${home}\\proj and ${home.toLowerCase()}` }], repairs: [] };
    const text = exportDoctor(report);
    expect(text.toLowerCase()).not.toContain(path.basename(home).toLowerCase());
    expect(JSON.parse(text).findings[0].detail).toContain("~");
  });
  it("the exported report is JSON and the text report is deterministic in structure", () => {
    const report: DoctorReport = { generatedAt: "2026-01-01T00:00:00Z", overall: "warn", findings: [{ id: "x", area: "A", status: "warn", title: "Something", fix: "Do it", repair: "remove-corrupt-cache" }], repairs: [] };
    expect(JSON.parse(exportDoctor(report)).overall).toBe("warn");
    const text = formatDoctor(report);
    expect(text).toContain("works, with things worth fixing");
    expect(text).toContain("jpe doctor --repair");
  });
});

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext } from "../../src/cli/context.js";
import { createServer } from "../../src/mcp/server.js";
import { TOOLS } from "../../src/mcp/tools.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
let base = "";
let project = "";

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-mcp-"));
  project = path.join(base, "project");
  await mkdir(project);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function connect(): Promise<Client> {
  const server = createServer((capture) =>
    createContext({
      ...capture,
      cwd: project,
      pathEnv: { platform: process.platform, env: { CLAUDE_PLUGIN_DATA: path.join(base, "data") }, homedir: base },
      git: async () => ({ exitCode: 128, stdout: "" }),
    }),
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

const textOf = (result: unknown): string => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? "");

describe("tool catalogue", () => {
  it("lists every tool with a title, description, input schema and honest annotations", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const t of tools) {
      expect(t.description?.length, t.name).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName["jpe_run_verify"]?.annotations?.readOnlyHint).toBe(false);
    expect(byName["jpe_overview"]?.annotations?.readOnlyHint).toBe(true);
    expect(byName["jpe_research"]?.annotations?.openWorldHint).toBe(true);
    expect(byName["jpe_overview"]?.annotations?.openWorldHint).toBe(false);
    await client.close();
  });

  it("deliberately offers no tool that changes settings, rolls back, installs or deletes", () => {
    for (const t of TOOLS) {
      expect(t.name, t.name).not.toMatch(/set|rollback|install(?!_plan)|delete|write|edit|prune/);
    }
    const argvs = TOOLS.map((t) => t.argv({ kind: "file", target: "x", file: "x", library: "x", language: "go", files: ["x"] }).join(" "));
    expect(argvs.some((a) => /config set|config import|backup (create|rollback|seal|prune)/.test(a))).toBe(false);
  });
});

describe("tool calls", () => {
  it("returns the same project overview as the CLI", async () => {
    await writeFile(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    const client = await connect();
    const out = textOf(await client.callTool({ name: "jpe_overview", arguments: {} }));
    expect(out).toContain("[unit-test] npm run test");
    await client.close();
  });

  it("builds an explanation briefing for a file and for an error", async () => {
    await mkdir(path.join(project, "src"));
    await writeFile(path.join(project, "src", "a.ts"), "export function add(a: number, b: number) { return a + b; }\n");
    const client = await connect();
    const file = textOf(await client.callTool({ name: "jpe_briefing", arguments: { kind: "file", target: "src/a.ts", phase: "before" } }));
    expect(file).toContain("before coding");
    expect(file).toContain("function add");
    const error = textOf(await client.callTool({ name: "jpe_briefing", arguments: { kind: "error", target: "Error: listen EADDRINUSE: address already in use :::3000" } }));
    expect(error).toContain("port the server wants is already taken");
    await client.close();
  });

  it("researches an installed package offline from local files only", async () => {
    await writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { zod: "^4.0.0" } }));
    await mkdir(path.join(project, "node_modules", "zod"), { recursive: true });
    await writeFile(path.join(project, "node_modules", "zod", "package.json"), JSON.stringify({ name: "zod", version: "4.1.2", types: "index.d.ts" }));
    await writeFile(path.join(project, "node_modules", "zod", "index.d.ts"), "export declare function strictObject<T>(shape: T): T;\n");
    const client = await connect();
    const out = textOf(await client.callTool({ name: "jpe_research", arguments: { library: "zod", topic: "strictObject", offline: true } }));
    expect(out).toContain("MODE: offline");
    expect(out).toContain("strictObject<T>(shape: T)");
    expect(out).toContain("<untrusted-content");
    await client.close();
  });

  it("runs verification and reports NOT_TESTED honestly when nothing exists, without erroring", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "jpe_run_verify", arguments: {} });
    expect(textOf(result)).toContain("STATUS: NOT_TESTED");
    expect(result.isError).toBeFalsy();
    const status = await client.callTool({ name: "jpe_verify_status", arguments: {} });
    expect(textOf(status)).toContain("NOT_TESTED");
    await client.close();
  });

  it("scans for credentials without returning their values", async () => {
    await writeFile(path.join(project, "k.ts"), "const k = 'sk-abcdefghijklmnop1234';\n");
    const client = await connect();
    const out = textOf(await client.callTool({ name: "jpe_scan", arguments: { paths: ["k.ts"] } }));
    expect(out).toContain("k.ts:1 anthropic-or-openai-key");
    expect(out).not.toContain("abcdefghijklmnop1234");
    await client.close();
  });

  it("shows install options and config without side effects", async () => {
    const client = await connect();
    expect(textOf(await client.callTool({ name: "jpe_install_plan", arguments: { language: "rust" } }))).toContain("Nothing has been run");
    expect(JSON.parse(textOf(await client.callTool({ name: "jpe_config_show", arguments: {} }))).engineering.maxRepairAttempts).toBe(3);
    expect(textOf(await client.callTool({ name: "jpe_backup_list", arguments: {} }))).toContain("No backups");
    await client.close();
  });
});

describe("input safety", () => {
  it("rejects flag-shaped values, NUL bytes, wrong types and unknown enum values before anything runs", async () => {
    const client = await connect();
    const bad: Array<[string, Record<string, unknown>]> = [
      ["jpe_research", { library: "--offline" }],
      ["jpe_research", { library: "zod", version: "-1" }],
      ["jpe_impact", { file: "--force" }],
      ["jpe_scan", { paths: ["-rf"] }],
      ["jpe_briefing", { kind: "file", target: "a\0b" }],
      ["jpe_briefing", { kind: "everything", target: "x" }],
      ["jpe_install_plan", { language: "cobol" }],
      ["jpe_run_verify", { only: ["rm -rf"] }],
      ["jpe_impact", { file: "a.ts", line: -3 }],
      ["jpe_lsp_diagnostics", { files: [] }],
    ];
    for (const [name, args] of bad) {
      const result = await client.callTool({ name, arguments: args }).catch(() => ({ isError: true, content: [{ text: "rejected" }] }));
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
    await client.close();
  });

  it("keeps file access inside the project and turns failures into short tool errors", async () => {
    const client = await connect();
    const escapeAttempt = await client.callTool({ name: "jpe_briefing", arguments: { kind: "file", target: "../outside.ts" } });
    expect(escapeAttempt.isError).toBe(true);
    expect(textOf(escapeAttempt)).toContain("outside the project");
    const missing = await client.callTool({ name: "jpe_briefing", arguments: { kind: "file", target: "nope.ts" } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).not.toMatch(/\bat \w+.*\(/); // no stack traces
    await client.close();
  });

  it("flag-like text inside a legitimate value cannot become a CLI flag", async () => {
    const client = await connect();
    const out = textOf(await client.callTool({ name: "jpe_briefing", arguments: { kind: "error", target: "--force EADDRINUSE --json" } }));
    expect(out).toContain("ERROR EXPLANATION BRIEFING");
    expect(out).toContain("port the server wants is already taken");
    await client.close();
  });
});

describe.skipIf(!existsSync(path.join(ROOT, "dist", "mcp.js")))("built server over real stdio", () => {
  it("starts as a separate process, lists its tools and answers a call", async () => {
    await writeFile(path.join(project, "package.json"), JSON.stringify({ scripts: { build: "tsup" } }));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "dist", "mcp.js")],
      cwd: project,
      env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: path.join(base, "data") },
    });
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(TOOLS.length);
      expect(textOf(await client.callTool({ name: "jpe_overview", arguments: {} }))).toContain("[build] npm run build");
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe("plugin.json MCP declaration", () => {
  it("launches the bundled server with the plugin root variable", async () => {
    const { readFile } = await import("node:fs/promises");
    const cfg = JSON.parse(await readFile(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8")) as { mcpServers: Record<string, { command: string; args: string[] }> };
    expect(cfg.mcpServers["jpe"]).toEqual({ command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp.js"] });
  });

  it("has no root .mcp.json, which Claude Code would also load as a failing project-scope server", async () => {
    const { access } = await import("node:fs/promises");
    await expect(access(path.join(ROOT, ".mcp.json"))).rejects.toThrow();
  });
});

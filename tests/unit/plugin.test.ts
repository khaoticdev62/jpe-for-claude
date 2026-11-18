import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_NAMES } from "../../src/cli/main.js";
import { TOOLS } from "../../src/mcp/tools.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

interface Doc {
  file: string;
  front: Record<string, string>;
  body: string;
}

async function load(file: string): Promise<Doc> {
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m?.[1]) throw new Error(`${file} has no front matter`);
  const front: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv?.[1]) front[kv[1]] = (kv[2] ?? "").replace(/^"(.*)"$/, "$1");
  }
  return { file, front, body: m[2] ?? "" };
}

const SKILLS = ["jpe", "explain", "research", "verify", "fix", "impact", "learn", "status", "audit", "review", "agents", "setup", "config"];
const AGENTS = ["jpe-researcher", "jpe-explainer", "jpe-lsp", "jpe-verifier", "jpe-security", "jpe-architect", "jpe-debugger"];

describe("plugin manifest", () => {
  it("names the plugin jpe and declares only documented fields", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
    expect(manifest["name"]).toBe("jpe");
    const allowed = new Set(["name", "displayName", "version", "description", "license", "keywords", "author", "homepage", "repository", "icon", "mcpServers", "types"]);
    for (const key of Object.keys(manifest)) expect(allowed.has(key), key).toBe(true);
  });
});

describe("skills", () => {
  it("has exactly the thirteen required commands", async () => {
    const dirs = (await readdir(path.join(root, "skills"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs.sort()).toEqual([...SKILLS].sort());
  });

  it.each(SKILLS)("%s has a description and a body", async (name) => {
    const doc = await load(path.join(root, "skills", name, "SKILL.md"));
    expect((doc.front["description"] ?? "").length).toBeGreaterThan(40);
    expect(doc.body.length).toBeGreaterThan(200);
    expect(doc.body.split("\n").length).toBeLessThan(500);
  });

  it("the entry skill is named jpe so that bare /jpe resolves", async () => {
    expect((await load(path.join(root, "skills", "jpe", "SKILL.md"))).front["name"]).toBe("jpe");
  });

  it("commands that change things cannot be started by the model on its own", async () => {
    for (const name of ["jpe", "fix", "setup", "config"]) {
      expect((await load(path.join(root, "skills", name, "SKILL.md"))).front["disable-model-invocation"], name).toBe("true");
    }
  });

  it("the router sends every sub-command somewhere real", async () => {
    const body = (await load(path.join(root, "skills", "jpe", "SKILL.md"))).body;
    for (const sub of SKILLS.filter((s) => s !== "jpe")) expect(body, sub).toContain(sub);
  });
});

describe("agents", () => {
  it("has exactly the seven required agents", async () => {
    const files = (await readdir(path.join(root, "agents"))).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    expect(files.sort()).toEqual([...AGENTS].sort());
  });

  it.each(AGENTS)("%s has a matching name, a precise description and an explicit tool policy", async (name) => {
    const doc = await load(path.join(root, "agents", `${name}.md`));
    expect(doc.front["name"]).toBe(name);
    expect((doc.front["description"] ?? "").length).toBeGreaterThan(60);
    expect(Boolean(doc.front["tools"] ?? doc.front["disallowedTools"])).toBe(true);
    // Plugin agents may not declare these (Claude Code ignores them), so none should be present.
    for (const forbidden of ["hooks", "mcpServers", "permissionMode"]) expect(doc.front[forbidden], forbidden).toBeUndefined();
  });

  it("every agent uses an explicit read-only allow-list: no write, edit, shell or agent tools, and MCP tools named really exist", async () => {
    const realTools = new Set(TOOLS.map((t) => `mcp__plugin_jpe_jpe__${t.name}`));
    // Read-only external sources the researcher may use. A deny-list would also inherit every other MCP server's write tools.
    const readOnlyExternal = new Set([
      "WebFetch",
      "WebSearch",
      "mcp__plugin_context7_context7__resolve-library-id",
      "mcp__plugin_context7_context7__query-docs",
      "mcp__claude_ai_Context7__resolve-library-id",
      "mcp__claude_ai_Context7__query-docs",
    ]);
    for (const name of AGENTS) {
      const doc = await load(path.join(root, "agents", `${name}.md`));
      expect(doc.front["disallowedTools"], `${name} must use an allow-list, not a deny-list`).toBeUndefined();
      expect(doc.front["tools"], `${name} has no tools list`).toBeTruthy();
      for (const t of (doc.front["tools"] ?? "").split(",").map((x) => x.trim())) {
        expect(["Read", "Grep", "Glob", "LSP"].includes(t) || realTools.has(t) || readOnlyExternal.has(t), `${name} lists ${t}`).toBe(true);
      }
    }
  });

  it("every agent describes its responsibilities and only mentions tools it can actually use", async () => {
    for (const name of AGENTS) {
      const doc = await load(path.join(root, "agents", `${name}.md`));
      expect(doc.body, name).toMatch(/Responsibilities/);
      for (const m of doc.body.matchAll(/`(jpe_[a-z_]+)`/g)) {
        expect(TOOLS.some((t) => t.name === m[1]), `${name} mentions ${m[1]}`).toBe(true);
        if (doc.front["tools"]) expect(doc.front["tools"], `${name} mentions ${m[1]} but cannot call it`).toContain(`mcp__plugin_jpe_jpe__${m[1]}`);
      }
    }
  });
});

describe("references to the command line", () => {
  it("every `cli.js <command>` named in skills and agents is a real command", async () => {
    const files: string[] = [];
    for (const s of SKILLS) files.push(path.join(root, "skills", s, "SKILL.md"));
    for (const a of AGENTS) files.push(path.join(root, "agents", `${a}.md`));
    const real = new Set(COMMAND_NAMES);
    for (const f of files) {
      const text = await readFile(f, "utf8");
      for (const m of text.matchAll(/dist\/cli\.js"\s+([a-z-]+)/g)) expect(real.has(m[1] ?? ""), `${path.basename(path.dirname(f))}/${path.basename(f)}: ${m[1]}`).toBe(true);
    }
  });
});

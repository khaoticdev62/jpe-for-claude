import { createInterface } from "node:readline";
import path from "node:path";
import { isJpeError } from "../core/errors.js";
import { runCommand, spawnSafely, killTree } from "../security/run.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { DoctorEnv, Finding } from "./types.js";

export const EXPECTED_SKILLS = ["jpe", "explain", "research", "verify", "fix", "impact", "learn", "status", "audit", "review", "setup", "config"] as const;
export const EXPECTED_AGENTS = ["jpe-researcher", "jpe-explainer", "jpe-lsp", "jpe-verifier", "jpe-security", "jpe-architect", "jpe-debugger"] as const;
const EXPECTED_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"] as const;
const MCP_PREFIX = "mcp__plugin_jpe_jpe__";

const f = (id: string, status: Finding["status"], title: string, extra: Partial<Finding> = {}): Finding => ({ id, area: "Plugin", status, title, ...extra });

async function readJson(env: DoctorEnv, ...parts: string[]): Promise<{ value?: unknown; error?: string }> {
  const file = path.join(env.pluginRoot ?? "", ...parts);
  const text = await env.ctx.fs.readText(file);
  if (text === undefined) return { error: `${parts.join("/")} is missing` };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: `${parts.join("/")} is not valid JSON` };
  }
}

/** One MCP stdio conversation: initialize, then tools/list. Uses plain JSON lines, so no SDK is needed here. */
export async function mcpHandshake(serverJs: string, cwd: string, timeoutMs = 10_000): Promise<{ ok: boolean; serverName?: string; tools: string[]; detail: string }> {
  let child: ReturnType<typeof spawnSafely>;
  try {
    child = spawnSafely(process.execPath, [serverJs], { cwd });
  } catch (error) {
    return { ok: false, tools: [], detail: isJpeError(error) ? error.userMessage : "could not start" };
  }
  return new Promise((resolve) => {
    let serverName: string | undefined;
    let done = false;
    const finish = (r: { ok: boolean; tools: string[]; detail: string }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killTree(child);
      // Wait (briefly) for the process to be really gone so it cannot keep the folder locked.
      const grace = setTimeout(() => resolve({ ...r, ...(serverName ? { serverName } : {}) }), 2000);
      child.once("close", () => {
        clearTimeout(grace);
        resolve({ ...r, ...(serverName ? { serverName } : {}) });
      });
      if (child.exitCode !== null) {
        clearTimeout(grace);
        resolve({ ...r, ...(serverName ? { serverName } : {}) });
      }
    };
    const timer = setTimeout(() => finish({ ok: false, tools: [], detail: `no answer within ${timeoutMs / 1000}s` }), timeoutMs);
    const send = (m: object): void => void child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
    createInterface({ input: child.stdout as NodeJS.ReadableStream }).on("line", (line) => {
      try {
        const msg = JSON.parse(line) as { id?: number; result?: { serverInfo?: { name?: string }; tools?: Array<{ name: string }> } };
        if (msg.id === 1) {
          serverName = msg.result?.serverInfo?.name;
          send({ method: "notifications/initialized" });
          send({ id: 2, method: "tools/list", params: {} });
        } else if (msg.id === 2) {
          const tools = (msg.result?.tools ?? []).map((t) => t.name);
          finish({ ok: tools.length > 0, tools, detail: `${tools.length} tools` });
        }
      } catch {
        // not a JSON line (should not happen on stdout); ignore
      }
    });
    child.on("error", () => finish({ ok: false, tools: [], detail: "the server process failed to start" }));
    child.on("close", () => finish({ ok: false, tools: [], detail: "the server exited before answering" }));
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "jpe-doctor", version: "1" } } });
  });
}

/** Checks the installed plugin itself: manifest, skills, agents, hooks, MCP server and the built bundles. */
export async function checkPlugin(env: DoctorEnv): Promise<Finding[]> {
  const out: Finding[] = [];
  const { ctx, pluginRoot } = env;
  if (!pluginRoot) {
    return [f("plugin-root", "fail", "The plugin folder could not be located.", { fix: "Reinstall the plugin, or run this from an installed copy (set CLAUDE_PLUGIN_ROOT)." })];
  }
  out.push(
    process.env["CLAUDE_PLUGIN_ROOT"]
      ? f("plugin-session", "ok", "Running inside Claude Code's plugin environment (CLAUDE_PLUGIN_ROOT is set).")
      : f("plugin-session", "info", "Not running inside a Claude Code plugin session; checked the plugin files on disk only.", { detail: pluginRoot }),
  );

  const manifest = await readJson(env, ".claude-plugin", "plugin.json");
  const name = (manifest.value as { name?: unknown } | undefined)?.name;
  out.push(manifest.error ? f("manifest", "fail", `Plugin manifest problem: ${manifest.error}.`, { fix: "Reinstall the plugin." }) : name === "jpe" ? f("manifest", "ok", "Plugin manifest is valid (name: jpe).") : f("manifest", "fail", `Plugin manifest has an unexpected name (${String(name)}).`));

  // Built bundles: skills, hooks and MCP all run these.
  for (const bundle of ["cli.js", "hook.js", "mcp.js", "package.json"]) {
    const present = await ctx.fs.exists(path.join(pluginRoot, "dist", bundle));
    if (present) out.push(f(`bundle-${bundle}`, "ok", `dist/${bundle} is present.`));
    else if (bundle === "package.json") out.push(f(`bundle-${bundle}`, "warn", "dist/package.json is missing, so Node re-parses the bundles on every start and prints warnings.", { fix: "Reinstall a release build of the plugin." }));
    else out.push(f(`bundle-${bundle}`, "fail", `dist/${bundle} is missing, so features that run it will not work.`, { fix: "Reinstall a release build of the plugin, or run `npm run build` in a source checkout." }));
  }

  // Skills.
  const skillProblems: string[] = [];
  for (const s of EXPECTED_SKILLS) {
    const text = await ctx.fs.readText(path.join(pluginRoot, "skills", s, "SKILL.md"));
    const parsed = text === undefined ? undefined : parseFrontmatter(text);
    if (!parsed) skillProblems.push(`${s}: missing or no front matter`);
    else if (!parsed.front["description"]) skillProblems.push(`${s}: no description`);
    else if (s === "jpe" && parsed.front["name"] !== "jpe") skillProblems.push("jpe: the entry skill must be named jpe so bare /jpe works");
  }
  out.push(skillProblems.length === 0 ? f("skills", "ok", `All ${EXPECTED_SKILLS.length} skills are present (/jpe and eleven sub-commands).`) : f("skills", "fail", "Some skills are missing or damaged.", { detail: skillProblems.join("; "), fix: "Reinstall the plugin." }));

  // MCP server first, so agent tool lists can be cross-checked against what it really offers.
  // The server is declared inline in plugin.json. A root .mcp.json is not used: Claude Code would also load it as a
  // project-scope server when the plugin folder is opened as a project, where ${CLAUDE_PLUGIN_ROOT} is undefined.
  type McpDeclaration = { mcpServers?: { jpe?: { command?: string; args?: string[] } } };
  const server = (manifest.value as McpDeclaration | undefined)?.mcpServers?.jpe;
  let serverTools: string[] | undefined;
  if (manifest.error || !server) {
    out.push(f("mcp-config", "fail", "The plugin's MCP configuration is missing or has no jpe server.", { fix: "Reinstall the plugin." }));
  } else if (server.command !== "node" || server.args?.[0] !== "${CLAUDE_PLUGIN_ROOT}/dist/mcp.js") {
    out.push(f("mcp-config", "warn", "The MCP configuration is not the standard one.", { detail: JSON.stringify(server) }));
  } else {
    const hs = (await ctx.fs.exists(path.join(pluginRoot, "dist", "mcp.js"))) ? await mcpHandshake(path.join(pluginRoot, "dist", "mcp.js"), ctx.cwd) : undefined;
    if (!hs) out.push(f("mcp-start", "fail", "The MCP server bundle is missing, so it could not be started."));
    else if (!hs.ok) out.push(f("mcp-start", "fail", `The JPE MCP server did not answer a real handshake (${hs.detail}).`, { fix: "Run `node dist/mcp.js` manually to see the error." }));
    else {
      serverTools = hs.tools;
      out.push(f("mcp-start", "ok", `The JPE MCP server started and offers ${hs.tools.length} tools (handshake completed).`, { area: "MCP" }));
    }
  }

  // Agents.
  const agentProblems: string[] = [];
  for (const a of EXPECTED_AGENTS) {
    const text = await ctx.fs.readText(path.join(pluginRoot, "agents", `${a}.md`));
    const parsed = text === undefined ? undefined : parseFrontmatter(text);
    if (!parsed) {
      agentProblems.push(`${a}: missing or no front matter`);
      continue;
    }
    if (parsed.front["name"] !== a) agentProblems.push(`${a}: name does not match the file`);
    if (!parsed.front["description"]) agentProblems.push(`${a}: no description`);
    for (const forbidden of ["hooks", "mcpServers", "permissionMode"]) if (parsed.front[forbidden] !== undefined) agentProblems.push(`${a}: declares ${forbidden}, which plugin agents cannot use`);
    const tools = (parsed.front["tools"] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    if (!parsed.front["tools"] && !parsed.front["disallowedTools"]) agentProblems.push(`${a}: no explicit tool policy`);
    for (const t of tools) {
      if (["Bash", "Write", "Edit", "NotebookEdit", "MultiEdit"].includes(t)) agentProblems.push(`${a}: has the powerful tool ${t}`);
      if (t.startsWith(MCP_PREFIX) && serverTools && !serverTools.includes(t.slice(MCP_PREFIX.length))) agentProblems.push(`${a}: lists ${t}, which the MCP server does not offer`);
    }
  }
  out.push(agentProblems.length === 0 ? f("agents", "ok", `All ${EXPECTED_AGENTS.length} agents are present with restricted tools that match the MCP server.`) : f("agents", "fail", "Some agents are missing, damaged or over-privileged.", { detail: agentProblems.join("; "), fix: "Reinstall the plugin." }));

  // Hooks: configuration, then a real run of the PreToolUse hook.
  const hooksJson = await readJson(env, "hooks", "hooks.json");
  const events = Object.keys((hooksJson.value as { hooks?: Record<string, unknown> } | undefined)?.hooks ?? {});
  if (hooksJson.error) out.push(f("hooks-config", "fail", `Hook configuration problem: ${hooksJson.error}.`, { area: "Hooks" }));
  else if (EXPECTED_HOOK_EVENTS.some((e) => !events.includes(e)) || events.some((e) => !(EXPECTED_HOOK_EVENTS as readonly string[]).includes(e))) {
    out.push(f("hooks-config", "warn", "The registered hook events differ from the expected set.", { area: "Hooks", detail: events.join(", ") }));
  } else out.push(f("hooks-config", "ok", `All ${events.length} hooks are registered exactly once.`, { area: "Hooks" }));

  // The command center interface: a module Claude Code loads beside the command hooks. Without it /jpe still works as
  // the text menu, so a problem here is a warning, not a failure.
  const modules = (hooksJson.value as { modules?: unknown } | undefined)?.modules;
  const moduleRegistered = Array.isArray(modules) && modules.includes("./center.js");
  if (!moduleRegistered) out.push(f("interface-module", "warn", "The command center interface is not registered in hooks/hooks.json, so /jpe shows the text menu instead of the pane.", { area: "Interface", fix: "Reinstall the plugin." }));
  else if (!(await ctx.fs.exists(path.join(pluginRoot, "hooks", "center.js")))) out.push(f("interface-module", "warn", "hooks/center.js is missing, so /jpe shows the text menu instead of the pane.", { area: "Interface", fix: "Reinstall a release build of the plugin, or run `npm run build` in a source checkout." }));
  else if (!(await ctx.fs.exists(path.join(pluginRoot, "types", "index.d.ts")))) out.push(f("interface-module", "warn", "types/index.d.ts is missing, which Claude Code needs to accept the command center interface.", { area: "Interface", fix: "Reinstall the plugin." }));
  else out.push(f("interface-module", "ok", "The command center interface module is installed.", { area: "Interface" }));

  const hookJs = path.join(pluginRoot, "dist", "hook.js");
  if (await ctx.fs.exists(hookJs)) {
    try {
      const payload = JSON.stringify({ session_id: "doctor-check", cwd: ctx.cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf doctor-smoke-test" } });
      const r = await runCommand({ file: process.execPath, args: [hookJs, "PreToolUse"], cwd: ctx.cwd, timeoutMs: 15_000, input: payload });
      let decision: string | undefined;
      try {
        decision = (JSON.parse(r.stdout) as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision;
      } catch {
        decision = undefined;
      }
      if (r.exitCode !== 0) out.push(f("hook-run", "fail", `The hook program exited with code ${r.exitCode}; hooks must always exit 0.`, { area: "Hooks" }));
      else if (decision === "ask") out.push(f("hook-run", "ok", "The hook program ran and correctly asked before a destructive command (no changes made).", { area: "Hooks" }));
      else out.push(f("hook-run", "info", "The hook program ran and exited cleanly but did not ask about a destructive command (approval mode may be 'off').", { area: "Hooks" }));
    } catch (error) {
      out.push(f("hook-run", "fail", `The hook program could not be run (${isJpeError(error) ? error.userMessage : "unexpected error"}).`, { area: "Hooks" }));
    }
  }
  return out;
}

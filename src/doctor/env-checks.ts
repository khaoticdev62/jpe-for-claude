import { mkdir, readdir, rm, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { store } from "../cli/commands/admin.js";
import { dataDir, globalConfigPath, projectConfigPath } from "../config/paths.js";
import { isJpeError } from "../core/errors.js";
import { DocCache } from "../docs/cache.js";
import { safeRequest } from "../docs/net.js";
import { pruneStaleStates } from "../hooks/state.js";
import { LspClient } from "../lsp/client.js";
import { checkServer, detectLanguages, findOnPath, listProjectFiles, type PathLookup } from "../lsp/detect.js";
import { detectProject } from "../project/detect.js";
import { readGitState } from "../project/git.js";
import { isSensitiveFileName } from "../security/scan.js";
import type { DoctorEnv, Finding } from "./types.js";

const f = (id: string, area: string, status: Finding["status"], title: string, extra: Partial<Finding> = {}): Finding => ({ id, area, status, title, ...extra });

const lookupFor = (env: DoctorEnv): PathLookup => ({ platform: env.ctx.pathEnv.platform, env: env.ctx.pathEnv.env, exists: (p) => env.ctx.fs.exists(p) });
export const cacheDir = (env: DoctorEnv): string => path.join(dataDir(env.ctx.pathEnv), "docs-cache");

async function runClaude(env: DoctorEnv, args: string[], timeoutMs: number): Promise<{ ok: boolean; text: string }> {
  const exe = await findOnPath("claude", lookupFor(env));
  if (!exe) return { ok: false, text: "" };
  try {
    const r = await env.ctx.run({ file: exe, args, cwd: env.ctx.cwd, timeoutMs });
    return { ok: r.exitCode === 0 && !r.timedOut, text: `${r.stdout}\n${r.stderr}`.trim() };
  } catch {
    return { ok: false, text: "" };
  }
}

export async function checkRuntime(env: DoctorEnv): Promise<Finding[]> {
  const out: Finding[] = [];
  const major = Number(/^v(\d+)/.exec(env.nodeVersion)?.[1] ?? 0);
  out.push(major >= 20 ? f("node", "Runtime", "ok", `Node.js ${env.nodeVersion} on ${env.ctx.pathEnv.platform} (JPE needs 20 or newer).`) : f("node", "Runtime", "fail", `Node.js ${env.nodeVersion} is too old; JPE needs version 20 or newer.`, { fix: "Install a current Node.js LTS release." }));

  const claude = await runClaude(env, ["--version"], 15_000);
  out.push(claude.ok ? f("claude", "Claude Code", "ok", `Claude Code is installed: ${claude.text.split("\n")[0]}.`) : f("claude", "Claude Code", "info", "The `claude` command was not found on PATH or did not run. This is fine if you start Claude Code another way (desktop app or IDE).", { fix: "If you use the terminal version, make sure `claude` is on your PATH." }));

  const git = await readGitState(env.ctx.git).catch(() => undefined);
  out.push(!git?.available ? f("git", "Runtime", "warn", "git is not installed, so JPE cannot see uncommitted work or file history.", { fix: "Install git." }) : f("git", "Runtime", "ok", git.isRepo ? `git works; this folder is on branch ${git.branch}${git.dirty ? ` with ${git.changedFiles.length} uncommitted file(s)` : " and is clean"}.` : "git works; this folder is not a repository."));

  if (env.deep && claude.ok) {
    const list = await runClaude(env, ["plugin", "list"], 30_000);
    const lines = list.text.split("\n").filter((l) => /jpe/i.test(l)).map((l) => l.trim());
    out.push(lines.length > 0 ? f("plugin-listed", "Claude Code", "ok", "`claude plugin list` mentions the jpe plugin.", { detail: lines.slice(0, 3).join(" | ") }) : f("plugin-listed", "Claude Code", "info", "`claude plugin list` does not mention jpe (expected when it is loaded with --plugin-dir for one session).", { fix: "Install it with `claude plugin install jpe@<marketplace>`." }));
    const mcp = await runClaude(env, ["mcp", "list"], 60_000);
    const c7 = mcp.text.split("\n").filter((l) => /context7/i.test(l)).map((l) => l.trim());
    out.push(c7.length > 0 ? f("context7", "Documentation", /✗|fail|error/i.test(c7.join(" ")) ? "warn" : "ok", "A Context7 MCP server is configured in Claude Code.", { detail: c7.slice(0, 2).join(" | ") }) : f("context7", "Documentation", "info", "No Context7 MCP server was seen in `claude mcp list`; the researcher agent will rely on installed packages, the registry and official sites.", { fix: "Optional: add the Context7 MCP server for richer documentation." }));
  }
  return out;
}

export async function checkConfig(env: DoctorEnv): Promise<Finding[]> {
  const { ctx } = env;
  const files = [globalConfigPath(ctx.pathEnv), projectConfigPath(ctx.cwd)];
  const present: string[] = [];
  for (const file of files) if ((await ctx.readText(file)) !== undefined) present.push(file);
  try {
    const cfg = await ctx.loadConfig();
    return [f("config", "Configuration", "ok", `Configuration is valid (${present.length === 0 ? "defaults only" : `${present.length} file(s) loaded`}${cfg.runtime.offline ? "; offline mode is ON" : ""}).`, present.length > 0 ? { detail: present.join(" | ") } : {})];
  } catch (error) {
    return [f("config", "Configuration", "fail", `Configuration is invalid: ${isJpeError(error) ? error.userMessage : "unexpected error"}`, { fix: "Fix the named file, or run `jpe config set` to rewrite the setting; the previous file is always kept as a .bak copy." })];
  }
}

export async function checkStorage(env: DoctorEnv): Promise<Finding[]> {
  const dir = dataDir(env.ctx.pathEnv);
  const out: Finding[] = [];
  try {
    await mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-${process.pid}`);
    await writeFile(probe, "x");
    await unlink(probe);
    out.push(f("storage", "Storage", "ok", "The local data folder is writable.", { detail: dir }));
  } catch {
    out.push(f("storage", "Storage", "fail", "The local data folder is not writable, so caches, backups and run records cannot be saved.", { detail: dir, fix: "Check permissions on that folder, or set CLAUDE_PLUGIN_DATA to a writable location.", repair: "create-data-dirs" }));
    return out;
  }
  try {
    const s = await statfs(dir);
    const freeMb = Math.floor((Number(s.bavail) * Number(s.bsize)) / 1_048_576);
    if (freeMb < 200) out.push(f("disk", "Storage", "warn", `Only ${freeMb} MB of disk space is free where JPE stores data.`, { fix: "Free some disk space." }));
  } catch {
    // free-space information is not available on every platform; not worth failing over
  }
  return out;
}

export async function checkCache(env: DoctorEnv): Promise<Finding[]> {
  const dir = cacheDir(env);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [f("cache", "Documentation", "info", "The documentation cache is empty (nothing has been researched yet).")];
  }
  const cache = new DocCache({ dir, now: env.ctx.now, ttlHours: 1 });
  let valid = 0;
  let corrupt = 0;
  for (const name of names) {
    if (name.includes(".tmp-")) {
      corrupt++;
      continue;
    }
    const key = name.replace(/\.json$/, "");
    if (!name.endsWith(".json") || !/^[a-f0-9]{64}$/.test(key)) continue;
    if (await cache.get(key)) valid++;
    else corrupt++;
  }
  return corrupt > 0
    ? [f("cache", "Documentation", "warn", `${corrupt} documentation cache entr${corrupt === 1 ? "y is" : "ies are"} damaged or tampered with (${valid} are fine). Damaged entries are never used.`, { fix: "Run `jpe doctor --repair` to delete the damaged entries.", repair: "remove-corrupt-cache" })]
    : [f("cache", "Documentation", "ok", `Documentation cache is healthy (${valid} entr${valid === 1 ? "y" : "ies"}, each hash-checked).`)];
}

export async function checkBackups(env: DoctorEnv): Promise<Finding[]> {
  const backups = store(env.ctx);
  const all = await backups.list();
  if (all.length === 0) return [f("backups", "Backups", "ok", "No backups yet (they are created automatically before Claude edits a file).")];
  const problems: string[] = [];
  for (const m of all.slice(0, 50)) {
    const v = await backups.verify(m.id).catch(() => ({ ok: false, problems: ["could not be read"] }));
    if (!v.ok) problems.push(`${m.id}: ${v.problems[0] ?? "damaged"}`);
  }
  const out: Finding[] = [problems.length === 0 ? f("backups", "Backups", "ok", `${all.length} backup(s); the newest ${Math.min(50, all.length)} were integrity-checked.`) : f("backups", "Backups", "fail", `${problems.length} backup(s) failed their integrity check, so they could not be restored safely.`, { detail: problems.slice(0, 3).join("; "), fix: "Do not roll back from those backups; take a fresh one." })];
  if (all.length > 100) out.push(f("backups-count", "Backups", "info", `${all.length} backups are stored; the oldest beyond 100 can be pruned.`, { repair: "prune-old-backups" }));
  return out;
}

export async function checkLanguageServers(env: DoctorEnv): Promise<Finding[]> {
  const { ctx } = env;
  const files = await listProjectFiles(ctx.cwd, ctx.git).catch(() => []);
  const languages = detectLanguages(files);
  if (languages.length === 0) return [f("lsp", "Language servers", "info", "No supported source files were found in this folder.")];
  const lookup = lookupFor(env);
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const { language, files: count } of languages) {
    if (seen.has(language.server.binary)) continue;
    seen.add(language.server.binary);
    const status = await checkServer(language, { lookup, run: ctx.run, cwd: ctx.cwd, timeoutMs: 10_000 });
    if (status.state === "missing") {
      out.push(f(`lsp-${language.id}`, "Language servers", "warn", `${language.name} (${count} files) has no language server installed, so LSP cannot verify it.`, { fix: `Run \`jpe install-plan ${language.id}\` or /jpe:setup to see install options.` }));
    } else if (status.state === "broken") {
      out.push(f(`lsp-${language.id}`, "Language servers", "fail", `${language.name}: ${status.detail}`, { fix: "Reinstall that language server." }));
    } else if (env.deep && status.path) {
      try {
        const client = await LspClient.start({ command: status.path, args: language.server.args, rootDir: ctx.cwd, startupTimeoutMs: 30_000 });
        await client.dispose();
        out.push(f(`lsp-${language.id}`, "Language servers", "ok", `${language.name}: ${status.binary} completed an LSP start-up handshake (${client.serverName ?? "server"}).`));
      } catch (error) {
        out.push(f(`lsp-${language.id}`, "Language servers", "fail", `${language.name}: ${status.binary} was found but did not complete an LSP handshake (${isJpeError(error) ? error.userMessage : "unexpected error"}).`));
      }
    } else {
      out.push(f(`lsp-${language.id}`, "Language servers", "ok", `${language.name}: ${status.detail}${status.state === "found" ? " Run with --deep to prove it starts." : ""}`));
    }
  }
  return out;
}

export async function checkNetwork(env: DoctorEnv): Promise<Finding[]> {
  const cfg = await env.ctx.loadConfig().catch(() => undefined);
  if (cfg?.runtime.offline) return [f("network", "Documentation", "info", "Offline mode is on, so online documentation sources are not used.")];
  if (!env.deep) return [f("network", "Documentation", "info", "Online sources were not tested. Run `jpe doctor --deep` to check the npm registry, OSV and GitHub.")];
  const probes: Array<[string, Parameters<typeof safeRequest>[0]]> = [
    ["npm registry", { url: "https://registry.npmjs.org/-/ping", allowedHosts: ["registry.npmjs.org"], timeoutMs: 10_000 }],
    ["OSV advisories", { url: "https://api.osv.dev/v1/query", method: "POST", body: JSON.stringify({ version: "4.17.20", package: { name: "lodash", ecosystem: "npm" } }), allowedHosts: ["api.osv.dev"], timeoutMs: 10_000 }],
    ["GitHub API", { url: "https://api.github.com/zen", allowedHosts: ["api.github.com"], timeoutMs: 10_000 }],
  ];
  const out: Finding[] = [];
  for (const [label, req] of probes) {
    try {
      await safeRequest(req, env.ctx.net);
      out.push(f(`net-${label}`, "Documentation", "ok", `${label} is reachable.`));
    } catch (error) {
      out.push(f(`net-${label}`, "Documentation", "warn", `${label} could not be reached (${isJpeError(error) ? error.userMessage : "unexpected error"}); research will fall back to installed packages and the cache.`));
    }
  }
  return out;
}

export async function checkProject(env: DoctorEnv): Promise<Finding[]> {
  const { ctx } = env;
  const out: Finding[] = [];
  const project = await detectProject(ctx.cwd, ctx.fs);
  out.push(f("project", "Project", "info", `Project: ${project.ecosystems.join(", ") || "no recognised language"}${project.packageManager ? ` (${project.packageManager})` : ""}${project.instructionFiles.length ? `; instruction files: ${project.instructionFiles.join(", ")}` : ""}.`));
  for (const w of project.warnings) out.push(f("project-warning", "Project", "warn", w));
  const tracked = (await ctx.git(["ls-files", "-z"]).catch(() => ({ exitCode: 1, stdout: "" }))).stdout.split("\0").filter((x) => x && isSensitiveFileName(x));
  if (tracked.length > 0) out.push(f("tracked-secrets", "Project", "fail", `Files that normally hold credentials are tracked by git: ${tracked.slice(0, 3).join(", ")}.`, { fix: "Remove them from git (git rm --cached), add them to .gitignore, and rotate any secrets they contained." }));
  return out;
}

export async function checkOffline(env: DoctorEnv): Promise<Finding[]> {
  const names = await readdir(cacheDir(env)).catch(() => []);
  const entries = names.filter((n) => n.endsWith(".json")).length;
  return [f("offline", "Offline", "info", `Offline readiness: explanations, local code inspection, installed-package documentation, installed language servers, local tests and builds, and configuration all work without a network. Cached online documentation: ${entries} entr${entries === 1 ? "y" : "ies"} (labelled "cached, not re-verified" when used). Not available offline: registry/release-note/advisory lookups for uncached libraries and Context7.`)];
}

/** Safe local repairs that `jpe doctor --repair` may perform. Nothing here touches project files or settings. */
export async function repair(env: DoctorEnv, id: string): Promise<string> {
  const { ctx } = env;
  switch (id) {
    case "create-data-dirs":
      await mkdir(path.join(dataDir(ctx.pathEnv), "docs-cache"), { recursive: true });
      await mkdir(ctx.stateDir(), { recursive: true });
      return "Created the data folders.";
    case "remove-corrupt-cache": {
      const dir = cacheDir(env);
      const cache = new DocCache({ dir, now: ctx.now, ttlHours: 1 });
      let removed = 0;
      for (const name of await readdir(dir).catch(() => [])) {
        const key = name.replace(/\.json$/, "");
        const isTemp = name.includes(".tmp-");
        if (!isTemp && (!name.endsWith(".json") || !/^[a-f0-9]{64}$/.test(key))) continue;
        if (isTemp || !(await cache.get(key))) {
          await rm(path.join(dir, name), { force: true });
          removed++;
        }
      }
      return `Removed ${removed} damaged cache file(s).`;
    }
    case "remove-stale-sessions": {
      await pruneStaleStates(ctx);
      return "Removed session records older than a week.";
    }
    case "prune-old-backups": {
      const removed = await store(ctx).prune(100);
      return `Removed ${removed.length} old backup(s), keeping the newest 100.`;
    }
    default:
      return "Unknown repair; nothing was done.";
  }
}

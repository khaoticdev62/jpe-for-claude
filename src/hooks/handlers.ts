import path from "node:path";
import { store } from "../cli/commands/admin.js";
import { makeAgentEvent } from "../agents/log.js";
import { pruneAgentEvents, recordAgentEvent } from "../agents/store.js";
import type { CliContext } from "../cli/context.js";
import { sha256Hex } from "../docs/cache.js";
import { explainError } from "../explain/errors.js";
import { collectLspDiagnostics } from "../lsp/diagnostics.js";
import { detectLanguages, findOnPath, listProjectFiles, type PathLookup } from "../lsp/detect.js";
import { languageForFile } from "../lsp/registry.js";
import { discoverChecks } from "../project/checks.js";
import { detectProject } from "../project/detect.js";
import { readGitState } from "../project/git.js";
import { assessCommand } from "../security/risk.js";
import { isSensitiveFileName, scanText } from "../security/scan.js";
import { context, type HookOutput, type PayloadOf } from "./payload.js";
import { fileKey, freshState, loadState, pruneStaleStates, saveState } from "./state.js";

const EDIT_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** Tools that run a command line; PowerShell is the primary shell on Windows when Claude Code's PowerShell tool is enabled. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);
const CODING_INTENT = /\b(implement|add|build|create|write|fix|refactor|rename|change|update|migrate|delete|remove|debug|optimi[sz]e|make|port|rewrite|edit|modify|replace|adjust|tweak|install|upgrade|bump|patch)\b/i;
const MAX_ADDITIONAL_CONTEXT = 1800;

const clip = (text: string): string => (text.length > MAX_ADDITIONAL_CONTEXT ? `${text.slice(0, MAX_ADDITIONAL_CONTEXT)}...` : text);

/** The file an edit tool is about to change or just changed, as an absolute path. */
export function editTarget(toolName: string, input: Record<string, unknown>, cwd: string): string | undefined {
  if (!EDIT_TOOLS.has(toolName)) return undefined;
  const raw = toolName === "NotebookEdit" ? input["notebook_path"] : input["file_path"];
  return typeof raw === "string" && raw !== "" ? path.resolve(cwd, raw) : undefined;
}

const insideProject = (root: string, file: string): boolean => {
  const rel = path.relative(root, file);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

const lookupFor = (ctx: CliContext): PathLookup => ({ platform: ctx.pathEnv.platform, env: ctx.pathEnv.env, exists: (f) => ctx.fs.exists(f) });

const WORKING_RULES = "Working rules: explain in plain English before and after substantial changes; report verification only from commands actually run, using the exact status word; never claim zero errors.";
const WELCOME_MESSAGE = "JPE For Claude is active. Try /jpe:verify to run this project's real checks, or /jpe:explain to get a plain-English walkthrough.";

/** True the first time JPE starts in a project: records a marker so the welcome shows once. */
async function isFirstRun(ctx: CliContext): Promise<boolean> {
  const marker = path.join(ctx.stateDir(), "welcomed");
  if ((await ctx.readText(marker).catch(() => undefined)) !== undefined) return false;
  await ctx.writeText(marker, ctx.now().toISOString()).catch(() => undefined);
  return true;
}

/**
 * SessionStart: a short, factual summary of the project and the rules JPE works by.
 * startup: full summary, fresh state, one-time welcome. clear: full summary, fresh state.
 * compact: short reminder only; the session continues, so its state is kept. resume: nothing.
 */
export async function onSessionStart(payload: PayloadOf<"SessionStart">, ctx: CliContext): Promise<HookOutput | undefined> {
  if (payload.source === "resume") return undefined;
  const cfg = await ctx.loadConfig();
  const project = await detectProject(ctx.cwd, ctx.fs);
  const checks = await discoverChecks(project, ctx.fs);
  const checkLine =
    checks.length > 0
      ? `Verification commands that exist: ${[...new Set(checks.map((c) => c.check))].join(", ")} (run /jpe:verify).`
      : "No verification commands were found: if asked whether something works, say it is NOT_TESTED rather than inventing tests.";

  if (payload.source === "compact") return context("SessionStart", clip(["JPE For Claude is still active in this project.", checkLine, WORKING_RULES].join("\n")));

  await pruneStaleStates(ctx);
  await pruneAgentEvents(ctx).catch(() => undefined);
  if (cfg.engineering.backups) await store(ctx).prune(100).catch(() => []);
  await saveState(ctx, payload.session_id, freshState(ctx));

  const git = await readGitState(ctx.git).catch(() => undefined);
  const files = await listProjectFiles(ctx.cwd, ctx.git).catch(() => []);
  const lookup = lookupFor(ctx);
  const missing: string[] = [];
  for (const { language } of detectLanguages(files).slice(0, 4)) {
    if (!(await findOnPath(language.server.binary, lookup)) && !missing.includes(language.server.binary)) missing.push(`${language.name} (${language.server.binary})`);
  }

  const lines = [
    "JPE For Claude is active in this project.",
    `Project: ${project.ecosystems.join(", ") || "no recognised language"}${project.packageManager ? ` (${project.packageManager})` : ""}. Git: ${!git?.available ? "git unavailable" : !git.isRepo ? "not a repository" : `branch ${git.branch}, ${git.dirty ? `${git.changedFiles.length} uncommitted file(s)` : "clean"}`}.`,
    checkLine,
    ...(project.instructionFiles.length > 0 ? [`Project instruction files to follow: ${project.instructionFiles.join(", ")}.`] : []),
    ...(missing.length > 0 ? [`Language servers not installed: ${missing.join(", ")} (see /jpe:setup). Without one, nothing is verified by LSP.`] : []),
    WORKING_RULES,
  ];
  const output = context("SessionStart", clip(lines.join("\n")));
  return payload.source === "startup" && (await isFirstRun(ctx)) ? { ...output, systemMessage: WELCOME_MESSAGE } : output;
}

/**
 * SubagentStart and SubagentStop: records that Claude Code reported an agent starting or stopping. It records ids, the
 * agent type, the time and the final message's length, never the task or the agent's words, and it never affects the agent:
 * no output, and a failure to record is swallowed (the run hook is fail-open).
 */
export async function onSubagentStart(payload: PayloadOf<"SubagentStart">, ctx: CliContext): Promise<HookOutput | undefined> {
  await recordAgentEvent(ctx, makeAgentEvent({ at: ctx.now(), kind: "start", agentId: payload.agent_id, agentType: payload.agent_type, sessionId: payload.session_id }));
  return undefined;
}

export async function onSubagentStop(payload: PayloadOf<"SubagentStop">, ctx: CliContext): Promise<HookOutput | undefined> {
  const chars = payload.last_assistant_message?.length;
  await recordAgentEvent(ctx, makeAgentEvent({ at: ctx.now(), kind: "stop", agentId: payload.agent_id, agentType: payload.agent_type, sessionId: payload.session_id, ...(chars === undefined ? {} : { finalMessageChars: chars }) }));
  return undefined;
}

/** UserPromptSubmit: a one-time workflow reminder, only when the prompt looks like a coding task. */
export async function onUserPrompt(payload: PayloadOf<"UserPromptSubmit">, ctx: CliContext): Promise<HookOutput | undefined> {
  if (!CODING_INTENT.test(payload.prompt.slice(0, 2000))) return undefined;
  const state = await loadState(ctx, payload.session_id);
  if (state.promptNudged) return undefined;
  await saveState(ctx, payload.session_id, { ...state, promptNudged: true });
  return context(
    "UserPromptSubmit",
    "JPE workflow for this task: look at the git state and project instructions first; say in plain English what will change and why before substantial edits; after editing, run /jpe:verify and report the exact status word and what was not checked. Edited files are backed up automatically (see `jpe backup list`).",
  );
}

const ask = (reason: string): HookOutput => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: `JPE: ${reason}` } });

/**
 * PreToolUse: makes Claude Code ask first for risky actions (it never approves anything itself),
 * and backs up a file the first time it is about to be edited in a session.
 */
export async function onPreToolUse(payload: PayloadOf<"PreToolUse">, ctx: CliContext): Promise<HookOutput | undefined> {
  const cfg = await ctx.loadConfig();
  const mode = cfg.engineering.approval;
  const { tool_name: tool, tool_input: input } = payload;

  if (SHELL_TOOLS.has(tool)) {
    const command = typeof input["command"] === "string" ? input["command"] : "";
    if (mode === "off" || command === "") return undefined;
    const risk = assessCommand(command);
    if (mode === "always") return ask(`approval mode is "always" (${risk.level}: ${risk.reason}).`);
    if (risk.level === "destructive") return ask(`this command looks destructive (${risk.reason}).`);
    if (risk.level === "needs-approval") return ask(`this command ${risk.reason}.`);
    return undefined;
  }

  const target = editTarget(tool, input, ctx.cwd);
  if (!target) return undefined;

  let decision: HookOutput | undefined;
  if (mode !== "off") {
    if (isSensitiveFileName(target)) decision = ask(`${path.basename(target)} looks like a credentials file; check what is being written.`);
    else if (mode === "always") decision = ask('approval mode is "always".');
  }

  if (cfg.engineering.backups && insideProject(ctx.cwd, target) && !isSensitiveFileName(target) && (await ctx.fs.exists(target))) {
    const state = await loadState(ctx, payload.session_id);
    const key = fileKey(target);
    if (!state.backups[key]) {
      try {
        const rel = path.relative(ctx.cwd, target);
        const backup = await store(ctx).create(ctx.cwd, [rel], `auto: before edit (session ${payload.session_id.slice(0, 8)})`);
        await saveState(ctx, payload.session_id, { ...state, backups: { ...state.backups, [key]: backup.id } });
      } catch {
        // an oversized or unreadable file simply gets no automatic backup
      }
    }
  }
  return decision;
}

/**
 * PostToolUse (edits): records the edit, seals its backup, and tells Claude about problems that are
 * cheap to detect now: credential-shaped text, invalid JSON, and language-server errors.
 */
export async function onPostToolUse(payload: PayloadOf<"PostToolUse">, ctx: CliContext): Promise<HookOutput | undefined> {
  const target = editTarget(payload.tool_name, payload.tool_input, ctx.cwd);
  if (!target || !insideProject(ctx.cwd, target)) return undefined;
  const cfg = await ctx.loadConfig();
  const state = await loadState(ctx, payload.session_id);
  const key = fileKey(target);
  const rel = path.relative(ctx.cwd, target).split(path.sep).join("/");
  const next = { ...state, edits: { ...state.edits, [key]: ctx.now().toISOString() } };

  const backupId = state.backups[key];
  if (backupId) await store(ctx).seal(backupId).catch(() => undefined);

  const notes: string[] = [];
  if (!isSensitiveFileName(target)) {
    const text = await ctx.fs.readText(target);
    if (text !== undefined) {
      const hash = sha256Hex(text);
      for (const f of scanText(text, rel).slice(0, 3)) notes.push(`${rel}:${f.line} contains text shaped like a credential (${f.rule}). Move it to an environment variable; do not leave secrets in source.`);
      if (rel.endsWith(".json")) {
        try {
          JSON.parse(text);
        } catch {
          notes.push(`${rel} is no longer valid JSON after this edit.`);
        }
      }
      const hit = languageForFile(target);
      if (hit && cfg.lsp.continuousDiagnostics && state.checked[key] !== hash && state.diagnosticsRuns < cfg.hooks.maxDiagnosticsPerSession) {
        const binary = await findOnPath(hit.language.server.binary, lookupFor(ctx));
        if (binary) {
          next.diagnosticsRuns = state.diagnosticsRuns + 1;
          next.checked = { ...state.checked, [key]: hash };
          const report = await collectLspDiagnostics(hit.language, {
            command: binary,
            args: hit.language.server.args,
            rootDir: ctx.cwd,
            files: [target],
            readFile: async () => text,
            startupTimeoutMs: 10_000,
            settleMs: 800,
            maxWaitMs: 8_000,
          });
          if (report.source === "lsp" && report.errors > 0) {
            notes.push(`The ${report.server} language server reports ${report.errors} error(s) in ${rel}:`);
            for (const d of report.diagnostics.filter((x) => x.severity === "error").slice(0, 8)) notes.push(`  line ${d.line}:${d.column} ${d.code ? `${d.code} ` : ""}${d.message}`);
          }
        }
      }
    }
  }

  await saveState(ctx, payload.session_id, next);
  return notes.length > 0 ? context("PostToolUse", clip(notes.join("\n"))) : undefined;
}

/** PostToolUseFailure: plain-English meaning of a failed command's error, when a known pattern matches. */
export async function onToolFailure(payload: PayloadOf<"PostToolUseFailure">, _ctx: CliContext): Promise<HookOutput | undefined> {
  if (!SHELL_TOOLS.has(payload.tool_name) || payload.is_interrupt || !payload.error) return undefined;
  const hit = explainError(payload.error.slice(0, 4000))[0];
  if (!hit) return undefined;
  return context("PostToolUseFailure", clip(`JPE: ${hit.title}. ${hit.plain} Usual causes: ${hit.causes} Usual fix: ${hit.usualFix} (general guidance; confirm against the actual code).`));
}

/** Stop: once per session, asks for verification when source files were edited and nothing has been run since. */
export async function onStop(payload: PayloadOf<"Stop">, ctx: CliContext): Promise<HookOutput | undefined> {
  if (payload.stop_hook_active) return undefined;
  const cfg = await ctx.loadConfig();
  if (!cfg.hooks.requireVerificationBeforeStop) return undefined;
  const state = await loadState(ctx, payload.session_id);
  if (state.stopNudged) return undefined;

  const sourceEdits = Object.entries(state.edits).filter(([file]) => languageForFile(file) !== undefined);
  if (sourceEdits.length === 0) return undefined;
  const lastEdit = sourceEdits.map(([, at]) => at).sort().at(-1) ?? "";

  const runText = await ctx.readText(path.join(ctx.stateDir(), "run.json"));
  if (runText) {
    try {
      const at = (JSON.parse(runText) as { at?: string }).at;
      if (typeof at === "string" && at >= lastEdit) return undefined;
    } catch {
      // unreadable run record counts as "no verification since the edit"
    }
  }
  const project = await detectProject(ctx.cwd, ctx.fs);
  if ((await discoverChecks(project, ctx.fs)).length === 0) return undefined;

  await saveState(ctx, payload.session_id, { ...state, stopNudged: true });
  const names = sourceEdits.map(([file]) => path.basename(file)).slice(0, 3).join(", ");
  return { decision: "block", reason: `JPE: ${sourceEdits.length} source file(s) were edited this session (${names}${sourceEdits.length > 3 ? ", ..." : ""}) and no verification has run since. Run /jpe:verify and report the exact status word, or tell the user plainly that the work is NOT_TESTED. This reminder appears once per session.` };
}

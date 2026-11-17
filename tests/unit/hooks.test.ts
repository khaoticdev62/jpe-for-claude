import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { onPostToolUse, onPreToolUse, onSessionStart, onStop, onToolFailure, onUserPrompt } from "../../src/hooks/handlers.js";
import { HOOK_EVENTS, parsePayload, safeSessionId } from "../../src/hooks/payload.js";
import { runHook, type HookRunDeps } from "../../src/hooks/run.js";
import { loadState } from "../../src/hooks/state.js";
import { store } from "../../src/cli/commands/admin.js";

const FAKE = fileURLToPath(new URL("../fixtures/fake-lsp.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

let base = "";
let project = "";
let binDir = "";
let n = 0;
let clock = 0;

function makeCtx(over: Partial<CliContext> = {}, extraPath = ""): CliContext {
  return createContext({
    cwd: project,
    pathEnv: { platform: process.platform, env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), PATH: extraPath }, homedir: base },
    git: async () => ({ exitCode: 128, stdout: "" }),
    now: () => new Date(Date.UTC(2026, 1, 3, 4, 5, ++clock)),
    newId: () => `id${++n}`,
    ...over,
  });
}

const common = (event: string, extra: Record<string, unknown> = {}) => ({ session_id: "sess-1234567890", cwd: project, hook_event_name: event, ...extra });
const write = async (rel: string, text: string): Promise<string> => {
  const file = path.join(project, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
};

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-hook-"));
  project = path.join(base, "project");
  binDir = path.join(base, "bin");
  await mkdir(project);
  await mkdir(binDir);
  n = 0;
  clock = 0;
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Puts a fake `typescript-language-server` (backed by the protocol test server) on a private PATH. */
async function installFakeServer(): Promise<string> {
  if (process.platform === "win32") await writeFile(path.join(binDir, "typescript-language-server.cmd"), `@node "${FAKE}" %*\r\n`);
  else {
    const file = path.join(binDir, "typescript-language-server");
    await writeFile(file, `#!/bin/sh\nexec node "${FAKE}" "$@"\n`);
    await chmod(file, 0o755);
  }
  return binDir;
}

describe("payload validation", () => {
  it("accepts documented shapes, tolerates extra fields, and rejects wrong or mismatched events", () => {
    const ok = parsePayload("PreToolUse", JSON.stringify(common("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" }, new_future_field: 1 })));
    expect(ok.tool_name).toBe("Bash");
    expect(() => parsePayload("PreToolUse", "nope")).toThrow(/not valid JSON/);
    expect(() => parsePayload("PreToolUse", JSON.stringify(common("PreToolUse")))).toThrow(/expected shape/);
    expect(() => parsePayload("Stop", JSON.stringify(common("PreToolUse")))).toThrow(/Expected a Stop payload/);
  });
  it("makes session ids file-name safe", () => {
    expect(safeSessionId("abc-123_X")).toBe("abc-123_X");
    expect(safeSessionId("../../etc/passwd")).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("SessionStart", () => {
  it("summarises the project and rules briefly, and stays quiet on resume", async () => {
    await write("package.json", JSON.stringify({ scripts: { test: "vitest run", build: "tsup" } }));
    await write("CLAUDE.md", "# rules");
    const out = await onSessionStart(parsePayload("SessionStart", JSON.stringify(common("SessionStart", { source: "startup" }))), makeCtx());
    const text = out?.hookSpecificOutput?.additionalContext ?? "";
    expect(out?.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(text).toContain("unit-test, build");
    expect(text).toContain("CLAUDE.md");
    expect(text).toContain("never claim zero errors");
    expect(text.length).toBeLessThan(1800);
    expect(await onSessionStart(parsePayload("SessionStart", JSON.stringify(common("SessionStart", { source: "resume" }))), makeCtx())).toBeUndefined();
  });
  it("says NOT_TESTED guidance when no checks exist", async () => {
    const out = await onSessionStart(parsePayload("SessionStart", JSON.stringify(common("SessionStart", { source: "startup" }))), makeCtx());
    expect(out?.hookSpecificOutput?.additionalContext).toContain("NOT_TESTED");
  });
  const start = (source: string, ctx = makeCtx()) => onSessionStart(parsePayload("SessionStart", JSON.stringify(common("SessionStart", { source }))), ctx);

  it("shows the welcome notice once per project, on startup only", async () => {
    const first = await start("startup");
    expect(first?.systemMessage).toContain("/jpe:verify");
    expect((await start("startup"))?.systemMessage).toBeUndefined();
    expect((await start("clear"))?.systemMessage).toBeUndefined();
  });
  it("never shows the welcome notice on clear, compact or resume", async () => {
    expect((await start("clear"))?.systemMessage).toBeUndefined();
    expect((await start("compact"))?.systemMessage).toBeUndefined();
    expect(await start("resume")).toBeUndefined();
  });
  it("gives a short reminder on compact and keeps the session's edit history", async () => {
    const ctx = makeCtx();
    await start("startup", ctx);
    const target = await write("src/a.ts", "export const a = 1;\n");
    await onPostToolUse(parsePayload("PostToolUse", JSON.stringify(common("PostToolUse", { tool_name: "Edit", tool_input: { file_path: target } }))), ctx);
    const before = Object.keys((await loadState(ctx, "sess-1234567890")).edits);
    expect(before).toHaveLength(1);

    const out = await start("compact", ctx);
    const text = out?.hookSpecificOutput?.additionalContext ?? "";
    expect(text).toContain("still active");
    expect(text).toContain("never claim zero errors");
    expect(text).not.toContain("Project:");
    expect(Object.keys((await loadState(ctx, "sess-1234567890")).edits)).toEqual(before);
  });
  it("starts a fresh session state on clear", async () => {
    const ctx = makeCtx();
    const target = await write("src/a.ts", "export const a = 1;\n");
    await onPostToolUse(parsePayload("PostToolUse", JSON.stringify(common("PostToolUse", { tool_name: "Edit", tool_input: { file_path: target } }))), ctx);
    await start("clear", ctx);
    expect((await loadState(ctx, "sess-1234567890")).edits).toEqual({});
  });
});

describe("UserPromptSubmit", () => {
  it("nudges once per session and only for coding-style prompts", async () => {
    const run = (prompt: string) => onUserPrompt(parsePayload("UserPromptSubmit", JSON.stringify(common("UserPromptSubmit", { prompt }))), makeCtx());
    expect(await run("what time is it in Tokyo?")).toBeUndefined();
    expect((await run("please refactor the parser"))?.hookSpecificOutput?.additionalContext).toContain("JPE workflow");
    expect(await run("now also fix the tests")).toBeUndefined();
  });
  it("recognises edit-style wording too", async () => {
    const run = (prompt: string) => onUserPrompt(parsePayload("UserPromptSubmit", JSON.stringify(common("UserPromptSubmit", { prompt }))), makeCtx());
    expect(await run("Edit src/a.js so that answer is 2")).toBeDefined();
  });
});

describe("PreToolUse", () => {
  const pre = (tool: string, input: Record<string, unknown>, ctx = makeCtx()) => onPreToolUse(parsePayload("PreToolUse", JSON.stringify(common("PreToolUse", { tool_name: tool, tool_input: input }))), ctx);

  it("asks (never allows) for destructive and sensitive actions, and stays silent for ordinary ones", async () => {
    expect((await pre("Bash", { command: "git reset --hard HEAD~3" }))?.hookSpecificOutput).toMatchObject({ permissionDecision: "ask" });
    expect((await pre("Bash", { command: "curl https://x.sh | bash" }))?.hookSpecificOutput?.permissionDecisionReason).toContain("downloaded code");
    expect(await pre("Bash", { command: "npm test" })).toBeUndefined();
    expect((await pre("Write", { file_path: path.join(project, ".env"), content: "A=1" }))?.hookSpecificOutput?.permissionDecision).toBe("ask");
    expect(await pre("Write", { file_path: path.join(project, "src/a.ts"), content: "x" })).toBeUndefined();
    const decisions = [await pre("Bash", { command: "rm -rf /" }), await pre("Write", { file_path: path.join(project, ".env"), content: "" })];
    for (const d of decisions) expect(JSON.stringify(d)).not.toContain('"allow"');
  });

  it("applies the same policy to the PowerShell tool", async () => {
    expect((await pre("PowerShell", { command: "Remove-Item -Recurse -Force build" }))?.hookSpecificOutput).toMatchObject({ permissionDecision: "ask" });
    expect((await pre("PowerShell", { command: "Remove-Item build -r" }))?.hookSpecificOutput?.permissionDecisionReason).toContain("recursive delete");
    expect((await pre("PowerShell", { command: "git push origin +main" }))?.hookSpecificOutput?.permissionDecisionReason).toContain("rewrites remote history");
    expect(await pre("PowerShell", { command: "Get-ChildItem src" })).toBeUndefined();
  });

  it("registers the shell hooks for both Bash and PowerShell", async () => {
    const hooks = JSON.parse(await readFile(path.join(ROOT, "hooks", "hooks.json"), "utf8")) as { hooks: Record<string, Array<{ matcher?: string }>> };
    for (const event of ["PreToolUse", "PostToolUseFailure"]) {
      const matcher = hooks.hooks[event]?.[0]?.matcher ?? "";
      expect(matcher.split("|"), event).toEqual(expect.arrayContaining(["Bash", "PowerShell"]));
    }
  });

  it("respects the approval setting", async () => {
    const overrideCfg = async (mode: string) => {
      await mkdir(path.join(base, "data"), { recursive: true });
      await writeFile(path.join(base, "data", "config.json"), JSON.stringify({ schemaVersion: 1, engineering: { approval: mode } }));
    };
    await overrideCfg("off");
    expect(await pre("Bash", { command: "rm -rf build" })).toBeUndefined();
    await overrideCfg("always");
    expect((await pre("Bash", { command: "ls" }))?.hookSpecificOutput?.permissionDecisionReason).toContain("always");
    expect((await pre("Edit", { file_path: path.join(project, "a.ts") }))?.hookSpecificOutput?.permissionDecision).toBe("ask");
  });

  it("backs up an existing file once per session before its first edit, and skips new, outside and credential files", async () => {
    const file = await write("src/a.ts", "original");
    const ctx = makeCtx();
    expect(await pre("Edit", { file_path: file, old_string: "a", new_string: "b" }, ctx)).toBeUndefined();
    await pre("Edit", { file_path: file }, ctx);
    const backups = await store(ctx).list();
    expect(backups).toHaveLength(1);
    expect(backups[0]?.files[0]).toMatchObject({ path: "src/a.ts", existed: true });
    await pre("Write", { file_path: path.join(project, "brand-new.ts") }, ctx);
    await pre("Write", { file_path: path.join(base, "outside.ts") }, ctx);
    await write(".env", "SECRET=1");
    await pre("Edit", { file_path: path.join(project, ".env") }, ctx);
    expect(await store(ctx).list()).toHaveLength(1);
  });
});

describe("PostToolUse", () => {
  const post = (file: string, ctx: CliContext, tool = "Edit") =>
    onPostToolUse(parsePayload("PostToolUse", JSON.stringify(common("PostToolUse", { tool_name: tool, tool_input: { file_path: file }, tool_response: { success: true } }))), ctx);

  it("seals the backup so a later rollback can tell who changed the file", async () => {
    const ctx = makeCtx();
    const file = await write("src/a.ts", "original");
    await onPreToolUse(parsePayload("PreToolUse", JSON.stringify(common("PreToolUse", { tool_name: "Edit", tool_input: { file_path: file } }))), ctx);
    await writeFile(file, "claude edit");
    await post(file, ctx);
    const [backup] = await store(ctx).list();
    expect(backup?.sealed).toBe(true);
    const r = await store(ctx).rollback(backup?.id as string);
    expect(r.restored).toHaveLength(1);
    expect(await readFile(file, "utf8")).toBe("original");
    expect((await loadState(ctx, "sess-1234567890")).edits).not.toEqual({});
  });

  it("warns about credential-shaped text and invalid JSON without echoing the secret", async () => {
    const ctx = makeCtx();
    const out = await post(await write("src/k.ts", "const key = 'sk-abcdefghijklmnop1234';\n"), ctx);
    expect(out?.hookSpecificOutput?.additionalContext).toContain("shaped like a credential");
    expect(JSON.stringify(out)).not.toContain("abcdefghijklmnop1234");
    const json = await post(await write("data.json", "{ nope"), ctx);
    expect(json?.hookSpecificOutput?.additionalContext).toContain("no longer valid JSON");
    expect(await post(await write("ok.json", "{}"), ctx)).toBeUndefined();
  });

  it("reports real language-server errors for the edited file, once per content, within budget", async () => {
    const dir = await installFakeServer();
    const ctx = makeCtx({}, dir);
    const file = await write("src/bad.ts", "const a = 1;\nconst BAD = 2;\n");
    const out = await post(file, ctx);
    expect(out?.hookSpecificOutput?.additionalContext).toContain("1 error(s) in src/bad.ts");
    expect(out?.hookSpecificOutput?.additionalContext).toContain("line 2:7 E1 BAD token");
    expect(await post(file, ctx)).toBeUndefined(); // same content: not re-checked
    expect((await loadState(ctx, "sess-1234567890")).diagnosticsRuns).toBe(1);
    const clean = await write("src/good.ts", "const a = 1;\n");
    expect(await post(clean, ctx)).toBeUndefined();
  }, 60_000);

  it("skips diagnostics when disabled, when no server is installed, and for non-edit tools", async () => {
    const dir = await installFakeServer();
    await mkdir(path.join(base, "data"), { recursive: true });
    await writeFile(path.join(base, "data", "config.json"), JSON.stringify({ schemaVersion: 1, lsp: { continuousDiagnostics: false } }));
    const file = await write("src/bad.ts", "BAD\n");
    expect(await post(file, makeCtx({}, dir))).toBeUndefined();
    await rm(path.join(base, "data", "config.json"));
    expect(await post(file, makeCtx({}, ""))).toBeUndefined();
    expect(await post(file, makeCtx({}, dir), "Read")).toBeUndefined();
  });
});

describe("PostToolUseFailure", () => {
  const fail = (error: string, extra: Record<string, unknown> = {}) =>
    onToolFailure(parsePayload("PostToolUseFailure", JSON.stringify(common("PostToolUseFailure", { tool_name: "Bash", tool_input: {}, error, ...extra }))), makeCtx());
  it("explains recognised errors, stays silent for unknown ones and interrupts", async () => {
    expect((await fail("TypeError: Cannot read properties of undefined (reading 'x')"))?.hookSpecificOutput?.additionalContext).toContain("Usual fix");
    expect(await fail("something unrecognisable")).toBeUndefined();
    expect(await fail("EADDRINUSE", { is_interrupt: true })).toBeUndefined();
  });
  it("also explains failures from the PowerShell tool, and ignores other tools", async () => {
    const run = (tool: string) =>
      onToolFailure(parsePayload("PostToolUseFailure", JSON.stringify(common("PostToolUseFailure", { tool_name: tool, tool_input: {}, error: "TypeError: Cannot read properties of undefined (reading 'x')" }))), makeCtx());
    expect((await run("PowerShell"))?.hookSpecificOutput?.additionalContext).toContain("Usual fix");
    expect(await run("Read")).toBeUndefined();
  });
});

describe("Stop", () => {
  const stop = (ctx: CliContext, extra: Record<string, unknown> = {}) => onStop(parsePayload("Stop", JSON.stringify(common("Stop", extra))), ctx);
  const edit = async (ctx: CliContext, file: string) => {
    await writeFile(file, "changed");
    await onPostToolUse(parsePayload("PostToolUse", JSON.stringify(common("PostToolUse", { tool_name: "Edit", tool_input: { file_path: file } }))), ctx);
  };

  it("does nothing when no source was edited or no checks exist", async () => {
    const ctx = makeCtx();
    expect(await stop(ctx)).toBeUndefined();
    await edit(ctx, await write("src/a.ts", "x"));
    expect(await stop(ctx)).toBeUndefined(); // edited, but the project has no verification commands
  });

  it("blocks once when edits are unverified, then never again, and respects stop_hook_active", async () => {
    await write("package.json", JSON.stringify({ scripts: { test: "vitest run" } }));
    const ctx = makeCtx();
    await edit(ctx, await write("src/a.ts", "x"));
    expect(await stop(ctx, { stop_hook_active: true })).toBeUndefined();
    const first = await stop(ctx);
    expect(first).toMatchObject({ decision: "block" });
    expect(first?.reason).toContain("/jpe:verify");
    expect(first?.reason).toContain("a.ts");
    expect(await stop(ctx)).toBeUndefined();
  });

  it("stays quiet when a verification ran after the last edit, or the setting is off", async () => {
    await write("package.json", JSON.stringify({ scripts: { test: "vitest run" } }));
    const ctx = makeCtx();
    await edit(ctx, await write("src/a.ts", "x"));
    await ctx.writeText(path.join(ctx.stateDir(), "run.json"), JSON.stringify({ at: "2999-01-01T00:00:00.000Z", required: ["unit-test"] }));
    expect(await stop(ctx)).toBeUndefined();

    const other = makeCtx({ cwd: project });
    await rm(path.join(other.stateDir(), "run.json"));
    await mkdir(path.join(base, "data"), { recursive: true });
    await writeFile(path.join(base, "data", "config.json"), JSON.stringify({ schemaVersion: 1, hooks: { requireVerificationBeforeStop: false } }));
    expect(await stop(other)).toBeUndefined();
  });
});

describe("runHook fails open", () => {
  const deps = (stdin: string, over: Partial<HookRunDeps> = {}) => {
    const written: string[] = [];
    const d: HookRunDeps = { readStdin: async () => stdin, makeContext: () => makeCtx(), write: (t) => void written.push(t), deadlineMs: 5000, debug: false, ...over };
    return { d, written };
  };

  it("writes valid JSON for a real event", async () => {
    const { d, written } = deps(JSON.stringify(common("PreToolUse", { tool_name: "Bash", tool_input: { command: "rm -rf x" } })));
    await runHook("PreToolUse", d);
    expect(JSON.parse(written.join("")).hookSpecificOutput.permissionDecision).toBe("ask");
  });
  it("produces no output and no exception for bad input, unknown events, mismatches, huge input and crashes", async () => {
    for (const [event, stdin] of [["PreToolUse", "garbage"], ["NotAnEvent", "{}"], ["Stop", JSON.stringify(common("PreToolUse"))], ["Stop", "x".repeat(3 * 1024 * 1024)]] as const) {
      const { d, written } = deps(stdin);
      await expect(runHook(event, d)).resolves.toBeUndefined();
      expect(written).toEqual([]);
    }
    const { d, written } = deps(JSON.stringify(common("Stop")), { makeContext: () => { throw new Error("boom"); } });
    await expect(runHook("Stop", d)).resolves.toBeUndefined();
    expect(written).toEqual([]);
  });
  it("gives up quietly when a handler outlasts the deadline, and logs only in debug mode", async () => {
    const slow = deps(JSON.stringify(common("SessionStart", { source: "startup" })), {
      deadlineMs: 1,
      debug: true,
      makeContext: () => makeCtx({ loadConfig: () => new Promise(() => undefined) }),
    });
    await runHook("SessionStart", slow.d);
    expect(slow.written).toEqual([]);
    const files = await readdir(path.join(base, "data", "projects")).catch(() => []);
    expect(files.length).toBeGreaterThan(0);
  });
});

describe("hooks.json", () => {
  it("registers each supported event exactly once with a valid exec-form command", async () => {
    const { hooks } = JSON.parse(await readFile(path.join(ROOT, "hooks", "hooks.json"), "utf8")) as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; args: string[]; timeout: number }> }>> };
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    for (const [event, groups] of Object.entries(hooks)) {
      expect(groups, event).toHaveLength(1);
      const handlers = groups[0]?.hooks ?? [];
      expect(handlers, event).toHaveLength(1);
      expect(handlers[0]).toMatchObject({ type: "command", command: "node" });
      expect(handlers[0]?.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/hook.js", event]);
      expect(handlers[0]?.timeout).toBeGreaterThan(0);
      expect(handlers[0]?.timeout).toBeLessThanOrEqual(30);
    }
    expect(hooks["PreToolUse"]?.[0]?.matcher).toContain("Bash");
    expect(hooks["PostToolUse"]?.[0]?.matcher).not.toContain("Bash");
  });
});

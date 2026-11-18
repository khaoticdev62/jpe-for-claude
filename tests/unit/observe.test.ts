import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { runResearch } from "../../src/cli/commands/research.js";
import { runCli } from "../../src/cli/main.js";
import { parseArgs } from "../../src/cli/args.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { runDoctor } from "../../src/doctor/doctor.js";
import { blockedNetDeps, type NetDeps } from "../../src/docs/net.js";
import { runHook } from "../../src/hooks/run.js";
import { cleanLogText, LOG_LEVELS, type LogEntry, makeLogEntry, MAX_LOG_ENTRIES, MAX_MESSAGE_CHARS, parseLog, parseLogEntry, recentEntries, serializeLogEntry, shouldLog, trimLog } from "../../src/obs/log.js";
import { LOG_FILE, loadLog, logEvent, pruneLog } from "../../src/obs/store.js";
import { logView, offlineView, type OfflineFacts } from "../../src/obs/views.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { lineWidth } from "../../src/ui/doc.js";
import { resolveProfile } from "../../src/ui/profile.js";

const T0 = Date.UTC(2026, 2, 4, 12, 0, 0);
const at = (ms: number): string => new Date(T0 + ms).toISOString();
const entry = (over: Partial<LogEntry> = {}): LogEntry => ({ at: at(0), level: "info", source: "hook:X", message: "hello", ...over });
const profile = (width: number) => resolveProfile(detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false, columns: width, rows: 40 }), defaultConfig().ui);
const text = (lines: ReadonlyArray<ReadonlyArray<{ text: string }>>): string => lines.map((l) => l.map((s) => s.text).join("")).join("\n");
const hasControl = (s: string): boolean =>
  Array.from(s).some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return (code <= 0x1f && code !== 0x0a) || (code >= 0x7f && code <= 0x9f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
  });

describe("log levels", () => {
  it("writes an entry only at or above the configured level, and always writes errors", () => {
    const table = LOG_LEVELS.flatMap((configured) => LOG_LEVELS.map((level) => [configured, level, shouldLog(configured, level)] as const));
    expect(table.filter(([, , w]) => w).length).toBe(4 + 3 + 2 + 1 + 3 /* errors below `error` are still written: 3 extra */ - 3);
    expect(shouldLog("error", "warn")).toBe(false);
    expect(shouldLog("error", "error")).toBe(true);
    expect(shouldLog("warn", "info")).toBe(false);
    expect(shouldLog("warn", "warn")).toBe(true);
    expect(shouldLog("info", "debug")).toBe(false);
    expect(shouldLog("debug", "debug")).toBe(true);
  });
});

describe("log entries", () => {
  it("removes secrets, control characters and line breaks, and limits length", () => {
    const esc = String.fromCharCode(27);
    const canary = "canaryvalue98765";
    expect(cleanLogText(`failed with ${["pass", "word"].join("")}=${canary} in config`, 200)).not.toContain(canary);
    expect(hasControl(cleanLogText(`a${esc}[31mb\n\tc‮d\u0007`, 200))).toBe(false);
    expect(cleanLogText("x".repeat(1000), MAX_MESSAGE_CHARS)).toHaveLength(MAX_MESSAGE_CHARS);
    expect(makeLogEntry({ at: new Date(T0), level: "warn", source: "", message: "m" }).source).toBe("jpe");
  });
  it("round-trips, and refuses anything that is not a valid entry", () => {
    expect(parseLogEntry(serializeLogEntry(entry()).trim())).toEqual(entry());
    for (const bad of ["{nope", "[]", "null", JSON.stringify({ ...entry(), level: "fatal" }), JSON.stringify({ ...entry(), at: "yesterday" }), JSON.stringify({ ...entry(), source: "" }), JSON.stringify({ ...entry(), message: 5 })]) {
      expect(parseLogEntry(bad), bad).toBeUndefined();
    }
  });
  it("re-cleans stored text, so a hand-edited file cannot inject control characters or secrets", () => {
    const stored = JSON.stringify({ ...entry(), message: "bad\u0007text token=abcdef123456secret" });
    const parsed = parseLogEntry(stored);
    expect(hasControl(parsed?.message ?? "")).toBe(false);
    expect(parsed?.message).not.toContain("abcdef123456secret");
  });
  it("skips damaged lines, trims to the latest entries, and filters newest first", () => {
    const many = Array.from({ length: MAX_LOG_ENTRIES + 5 }, (_, i) => serializeLogEntry(entry({ message: `m${i}` }))).join("");
    const trimmed = parseLog(trimLog(`junk\n${many}`));
    expect(trimmed).toHaveLength(MAX_LOG_ENTRIES);
    expect(trimmed.at(-1)?.message).toBe(`m${MAX_LOG_ENTRIES + 4}`);
    const mixed = [entry({ level: "debug", message: "d" }), entry({ level: "error", message: "e" }), entry({ level: "info", message: "i" }), entry({ level: "warn", message: "w" })];
    expect(recentEntries(mixed, "warn", 10).map((e) => e.message)).toEqual(["w", "e"]);
    expect(recentEntries(mixed, "debug", 2).map((e) => e.message)).toEqual(["w", "i"]);
  });
});

describe("the offline guarantee", () => {
  it("a blocked network handle refuses both lookups and requests", async () => {
    const net = blockedNetDeps();
    await expect(net.fetch(new URL("https://example.com/"))).rejects.toThrow(/Offline mode is on/);
    await expect(net.resolve("example.com")).rejects.toThrow(/Offline mode is on/);
  });

  describe("on a real project", () => {
    let base = "";
    let project = "";
    let calls = 0;
    const spy: NetDeps = {
      fetch: async () => {
        calls += 1;
        throw new Error("network used");
      },
      resolve: async () => {
        calls += 1;
        return ["93.184.216.34"];
      },
    };
    const makeCtx = (env: Record<string, string> = {}): CliContext =>
      createContext({
        cwd: project,
        out: () => undefined,
        err: () => undefined,
        net: spy,
        pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), PATH: "", ...env }, homedir: base },
        git: async () => ({ exitCode: 128, stdout: "" }),
        now: () => new Date(T0),
      });
    beforeEach(async () => {
      base = await mkdtemp(path.join(tmpdir(), "jpe-offline-"));
      project = path.join(base, "proj");
      await mkdir(path.join(project, "node_modules", "left-pad"), { recursive: true });
      await writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { "left-pad": "1.3.0" } }));
      await writeFile(path.join(project, "node_modules", "left-pad", "package.json"), JSON.stringify({ name: "left-pad", version: "1.3.0" }));
      calls = 0;
    });
    afterEach(async () => {
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    it("makes no network call at all when offline is set by the environment", async () => {
      const run = await runResearch(parseArgs(["left-pad"]), makeCtx({ JPE_OFFLINE: "1" }));
      expect(calls).toBe(0);
      expect(run.report.offline).toBe(true);
    });
    it("makes no network call at all when --offline is passed", async () => {
      const run = await runResearch(parseArgs(["left-pad", "--offline"]), makeCtx());
      expect(calls).toBe(0);
      expect(run.report.offline).toBe(true);
    });
    it("does use the network when online (so the zero above means something)", async () => {
      await runResearch(parseArgs(["left-pad"]), makeCtx());
      expect(calls).toBeGreaterThan(0);
    });
  });
});

describe("the log, the offline screen and the commands", () => {
  let base = "";
  let project = "";
  let envVars: Record<string, string> = {};
  let tick = 0;
  const out: string[] = [];
  const errs: string[] = [];
  const makeCtx = (over: Partial<CliContext> = {}): CliContext =>
    createContext({
      cwd: project,
      out: (t) => void out.push(t),
      err: (t) => void errs.push(t),
      pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), PATH: "", ...envVars }, homedir: base },
      git: async () => ({ exitCode: 128, stdout: "" }),
      now: () => new Date(T0 + ++tick * 1000),
      terminal: () => ({ isTTY: false, columns: undefined, rows: undefined }),
      ...over,
    });
  const globalFile = (): string => path.join(base, "data", "config.json");
  const run = (...argv: string[]): Promise<number> => runCli(argv, makeCtx());
  const logFile = (): string => path.join(makeCtx().stateDir(), LOG_FILE);
  const json = async <T,>(...argv: string[]): Promise<T> => {
    out.length = 0;
    expect(await run(...argv, "--json")).toBe(0);
    return JSON.parse(out.join("\n")) as T;
  };
  const setLevel = async (level: string): Promise<void> => {
    await mkdir(path.dirname(globalFile()), { recursive: true });
    await writeFile(globalFile(), JSON.stringify({ schemaVersion: 1, runtime: { logLevel: level } }));
  };

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "jpe-obs-"));
    project = path.join(base, "proj");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "package.json"), "{}");
    envVars = {};
    out.length = 0;
    errs.length = 0;
    tick = 0;
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("logEvent honours the configured level, and errors are always written", async () => {
    const ctx = makeCtx();
    await logEvent(ctx, "debug", "t", "dropped at the default level");
    await logEvent(ctx, "info", "t", "kept");
    expect((await loadLog(ctx)).map((e) => e.message)).toEqual(["kept"]);
    await setLevel("error");
    await logEvent(makeCtx(), "warn", "t", "dropped at error");
    await logEvent(makeCtx(), "error", "t", "always kept");
    expect((await loadLog(makeCtx())).map((e) => e.message)).toEqual(["kept", "always kept"]);
    await setLevel("debug");
    await logEvent(makeCtx(), "debug", "t", "now kept");
    expect((await loadLog(makeCtx())).at(-1)?.message).toBe("now kept");
  });

  it("logEvent can never fail its caller, even when the folder cannot be written", async () => {
    const blocked = path.join(base, "blocked");
    await writeFile(blocked, "i am a file, not a folder");
    const ctx = makeCtx({ stateDir: () => path.join(blocked, "state") });
    await expect(logEvent(ctx, "error", "t", "x")).resolves.toBeUndefined();
  });

  it("logging gives up quickly when what it depends on is stuck, instead of stalling the caller", async () => {
    const stuck = makeCtx({ loadConfig: () => new Promise(() => undefined) });
    const started = Date.now();
    await logEvent(stuck, "error", "t", "x");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await loadLog(makeCtx())).toEqual([]);
  });

  it("a damaged or missing log reads as empty, and pruning trims a long one", async () => {
    const ctx = makeCtx();
    expect(await loadLog(ctx)).toEqual([]);
    await mkdir(path.dirname(logFile()), { recursive: true });
    await writeFile(logFile(), "\u0000garbage\n");
    expect(await loadLog(ctx)).toEqual([]);
    await writeFile(logFile(), Array.from({ length: MAX_LOG_ENTRIES + 200 }, () => serializeLogEntry(entry())).join(""));
    await pruneLog(ctx);
    expect(parseLog(await readFile(logFile(), "utf8"))).toHaveLength(MAX_LOG_ENTRIES);
  });

  describe("hook runs", () => {
    const deps = (ctx: CliContext, input: unknown, deadlineMs = 5000) => ({ readStdin: async () => JSON.stringify(input), makeContext: () => ctx, write: () => undefined, deadlineMs, debug: false });
    const start = (extra: Record<string, unknown> = {}) => ({ session_id: "s-1", cwd: project, hook_event_name: "SessionStart", source: "startup", ...extra });

    it("a failing hook is recorded instead of vanishing (a damaged settings file is the real-world case)", async () => {
      await mkdir(path.dirname(globalFile()), { recursive: true });
      await writeFile(globalFile(), "{ not json");
      await runHook("SessionStart", deps(makeCtx(), start()));
      const [failure] = await loadLog(makeCtx());
      expect(failure).toMatchObject({ level: "error", source: "hook:SessionStart" });
      expect(failure?.message).toContain("INVALID_CONFIG");
      expect(failure?.message).toContain("added nothing");
    });

    it("a hook that runs out of time is recorded as a warning", async () => {
      await runHook("SessionStart", deps(makeCtx(), start(), 0));
      expect((await loadLog(makeCtx())).find((e) => e.level === "warn")?.message).toContain("timed out");
    });

    it("a session start is recorded as information, and a healthy hook writes no error", async () => {
      await runHook("SessionStart", deps(makeCtx(), start({ session_id: "s-2" })));
      const entries = await loadLog(makeCtx());
      expect(entries.some((e) => e.level === "info" && e.message.includes("session started (startup)"))).toBe(true);
      expect(entries.some((e) => e.level === "error")).toBe(false);
    });

    it("timings are written only at the debug level", async () => {
      await runHook("SessionStart", deps(makeCtx(), start({ session_id: "s-3" })));
      expect((await loadLog(makeCtx())).some((e) => e.level === "debug")).toBe(false);
      await setLevel("debug");
      await runHook("SessionStart", deps(makeCtx(), start({ session_id: "s-4" })));
      expect((await loadLog(makeCtx())).some((e) => e.level === "debug" && /finished in \d+ ms/.test(e.message))).toBe(true);
    });

    it("bad input before there is a project to log into writes nothing and does not throw", async () => {
      await expect(runHook("SessionStart", { ...deps(makeCtx(), {}), readStdin: async () => "{ not json" })).resolves.toBeUndefined();
      expect(await loadLog(makeCtx())).toEqual([]);
    });
  });

  it("`jpe log` shows entries newest first, filters by level, and --json has the same facts", async () => {
    const ctx = makeCtx();
    await logEvent(ctx, "info", "hook:A", "first");
    await logEvent(ctx, "error", "hook:B", "second");
    await logEvent(ctx, "warn", "hook:C", "third");
    expect(await run("log", "--width", "100")).toBe(0);
    const shown = out.join("\n");
    expect(shown.indexOf("third")).toBeLessThan(shown.indexOf("first"));
    const errorsOnly = await json<LogEntry[]>("log", "--level", "error");
    expect(errorsOnly.map((e) => e.message)).toEqual(["second"]);
    expect((await json<LogEntry[]>("log", "--limit", "1")).map((e) => e.message)).toEqual(["third"]);
  });

  it("`jpe log` explains an empty log, and one with only lower-level entries", async () => {
    expect(await run("log")).toBe(0);
    expect(out.join("\n")).toContain("no entry is good news");
    await logEvent(makeCtx(), "info", "hook:A", "only info");
    out.length = 0;
    await run("log", "--level", "error");
    expect(out.join("\n")).toContain("1 lower-level entry is recorded");
  });

  it("`jpe log` refuses a bad level or limit", async () => {
    expect(await run("log", "--level", "loud")).not.toBe(0);
    for (const limit of ["0", "-1", "abc", "1.5", "99999"]) expect(await run("log", "--limit", limit), limit).not.toBe(0);
  });

  it("`jpe log` still opens when the settings file is damaged, and says so", async () => {
    await mkdir(path.dirname(globalFile()), { recursive: true });
    await writeFile(globalFile(), "{ not json");
    await logEvent(makeCtx(), "error", "hook:A", "boom");
    out.length = 0;
    expect(await run("log", "--width", "100")).toBe(0);
    expect(out.join("\n")).toContain("could not be read");
    expect(out.join("\n")).toContain("boom");
  });

  it("`jpe offline` reports the mode, who set it, and the cache", async () => {
    const off = await json<OfflineFacts>("offline");
    expect(off).toMatchObject({ offline: false, source: "default", cachedDocs: 0 });
    expect(off.providers.some((p) => p.name === "local-package" && !p.needsNetwork)).toBe(true);
    expect(off.providers.some((p) => p.name === "osv" && p.needsNetwork)).toBe(true);
    await mkdir(path.dirname(globalFile()), { recursive: true });
    await writeFile(globalFile(), JSON.stringify({ schemaVersion: 1, runtime: { offline: true } }));
    await mkdir(path.join(base, "data", "docs-cache"), { recursive: true });
    await writeFile(path.join(base, "data", "docs-cache", "a.json"), "{}");
    await writeFile(path.join(base, "data", "docs-cache", "b.json"), "{}");
    expect(await json<OfflineFacts>("offline")).toMatchObject({ offline: true, source: "global", cachedDocs: 2 });
    envVars = { JPE_OFFLINE: "0" };
    expect(await json<OfflineFacts>("offline")).toMatchObject({ offline: false, source: "environment" });
  });

  it("`jpe offline` prints a readable screen for each mode", async () => {
    expect(await run("offline", "--width", "100")).toBe(0);
    expect(out.join("\n")).toContain("Offline mode is off");
    envVars = { JPE_OFFLINE: "1" };
    out.length = 0;
    await run("offline", "--width", "100");
    expect(out.join("\n")).toContain("Offline mode is ON");
    expect(out.join("\n")).toContain("JPE_OFFLINE environment variable");
  });

  it("the Doctor warns about recent hook failures and unreadable log lines, and says nothing about an absent log", async () => {
    const findings = async () => (await runDoctor({ ctx: makeCtx(), pluginRoot: undefined, deep: false, nodeVersion: process.version })).findings;
    expect((await findings()).some((f) => f.id === "hook-failures" || f.id === "log-record")).toBe(false);
    await logEvent(makeCtx({ now: () => new Date() }), "error", "hook:PreToolUse", "failed, so JPE added nothing to this step: boom");
    await writeFile(logFile(), `${await readFile(logFile(), "utf8")}garbage line\n`);
    const after = await findings();
    expect(after.find((f) => f.id === "hook-failures")).toMatchObject({ status: "warn" });
    expect(after.find((f) => f.id === "hook-failures")?.title).toContain("1 time");
    expect(after.find((f) => f.id === "log-record")).toMatchObject({ status: "warn" });
  });

  it("an old failure is not reported as recent", async () => {
    await mkdir(path.dirname(logFile()), { recursive: true });
    await writeFile(logFile(), serializeLogEntry(entry({ level: "error", at: new Date(Date.now() - 3 * 24 * 3_600_000).toISOString() })));
    const report = await runDoctor({ ctx: makeCtx({ now: () => new Date() }), pluginRoot: undefined, deep: false, nodeVersion: process.version });
    expect(report.findings.some((f) => f.id === "hook-failures")).toBe(false);
  });
});

describe("the observability screens", () => {
  const facts: OfflineFacts = { offline: true, source: "project", cachedDocs: 3, providers: [{ name: "local-package", needsNetwork: false }, { name: "official", needsNetwork: true }] };
  it("names what offline mode does and does not do", () => {
    const on = text(offlineView(facts, profile(100)));
    for (const part of ["Offline mode is ON", "this project's settings", "3 entries", "skipped (cached copy if any)", "What works offline", "What does not"]) expect(on, part).toContain(part);
    expect(text(offlineView({ ...facts, offline: false }, profile(100)))).toContain("Offline mode is off");
  });
  it("shows the log, a hostile entry safely, and the settings problem when there is one", () => {
    const esc = String.fromCharCode(27);
    const out = text(logView([entry({ message: `${esc}[31mred${esc}]0;title` })], new Date(T0 + 5000), "info", "info", 1, profile(100), "The global configuration is not valid JSON."));
    expect(hasControl(out)).toBe(false);
    expect(out).toContain("could not be read");
    expect(out).toContain("not valid JSON");
  });
  it.each([20, 40, 60, 80, 120, 200])("never overflows at %i columns", (width) => {
    const p = profile(width);
    const entries = [entry({ message: "failed, so JPE added nothing to this step: INVALID_CONFIG: The global configuration (a/very/long/path/to/config.json) is not valid JSON." })];
    for (const line of [...offlineView(facts, p), ...offlineView({ ...facts, offline: false }, p), ...logView(entries, new Date(T0), "info", "info", 1, p, "problem"), ...logView([], new Date(T0), "info", "info", 0, p)]) expect(lineWidth(line), String(width)).toBeLessThanOrEqual(width);
  });
});

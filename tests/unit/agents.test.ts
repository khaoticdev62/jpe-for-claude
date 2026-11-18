import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";
import { type AgentEvent, makeAgentEvent, MAX_AGENT_EVENTS, parseAgentEvent, parseAgentEvents, serializeAgentEvent, trimAgentEvents } from "../../src/agents/log.js";
import { agentsSentence, buildMetrics, buildRuns, formatDuration, STALE_AFTER_MS, summarize } from "../../src/agents/runs.js";
import { AGENT_EVENTS_FILE, loadAgentEvents, pruneAgentEvents } from "../../src/agents/store.js";
import { agentsView, SHOWN_RUNS } from "../../src/agents/views.js";
import { onSubagentStart, onSubagentStop } from "../../src/hooks/handlers.js";
import { parsePayload } from "../../src/hooks/payload.js";
import { runHook } from "../../src/hooks/run.js";
import type { HudData } from "../../src/center/hud-data.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { resolveProfile } from "../../src/ui/profile.js";
import { lineWidth } from "../../src/ui/doc.js";

const T0 = Date.UTC(2026, 2, 4, 12, 0, 0);
const at = (ms: number): string => new Date(T0 + ms).toISOString();
const ev = (over: Partial<AgentEvent> = {}): AgentEvent => ({ at: at(0), kind: "start", agentId: "a1", agentType: "Explore", sessionId: "s1", ...over });
const NOW = new Date(T0 + 60_000);

describe("agent event records", () => {
  it("round-trips a start and a stop", () => {
    const stop = ev({ kind: "stop", finalMessageChars: 120 });
    expect(parseAgentEvent(serializeAgentEvent(ev()).trim())).toEqual(ev());
    expect(parseAgentEvent(serializeAgentEvent(stop).trim())).toEqual(stop);
  });
  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["null", "null"],
    ["a bad time", JSON.stringify(ev({ at: "yesterday" }))],
    ["an unknown kind", JSON.stringify({ ...ev(), kind: "failed" })],
    ["no agent id", JSON.stringify({ ...ev(), agentId: "" })],
    ["a very long id", JSON.stringify(ev({ agentId: "x".repeat(300) }))],
    ["a negative length", JSON.stringify(ev({ kind: "stop", finalMessageChars: -1 }))],
    ["a fractional length", JSON.stringify(ev({ kind: "stop", finalMessageChars: 1.5 }))],
  ])("rejects %s", (_name, line) => {
    expect(parseAgentEvent(line)).toBeUndefined();
  });
  it("skips damaged lines and keeps the good ones in order", () => {
    const text = `${serializeAgentEvent(ev({ agentId: "a" }))}garbage\n\n${serializeAgentEvent(ev({ agentId: "b" }))}{"x":1}\n`;
    expect(parseAgentEvents(text).map((e) => e.agentId)).toEqual(["a", "b"]);
  });
  it("keeps only the most recent events when trimming, and drops damaged lines", () => {
    const lines = Array.from({ length: MAX_AGENT_EVENTS + 5 }, (_, i) => serializeAgentEvent(ev({ agentId: `a${i}` }))).join("");
    const trimmed = parseAgentEvents(trimAgentEvents(`junk\n${lines}`));
    expect(trimmed).toHaveLength(MAX_AGENT_EVENTS);
    expect(trimmed.at(-1)?.agentId).toBe(`a${MAX_AGENT_EVENTS + 4}`);
    expect(trimAgentEvents("only junk")).toBe("");
  });
  it("cuts over-long fields and names an empty type 'unknown'", () => {
    const made = makeAgentEvent({ at: new Date(T0), kind: "start", agentId: "x".repeat(500), agentType: "", sessionId: "s" });
    expect(made.agentId).toHaveLength(200);
    expect(made.agentType).toBe("unknown");
  });
});

describe("buildRuns", () => {
  it("a start without a stop, seen recently, is running", () => {
    const [run] = buildRuns([ev()], NOW);
    expect(run?.state).toBe("running");
    expect(run?.durationMs).toBeUndefined();
  });
  it("a start and a stop is finished, and only then has a duration", () => {
    const [run] = buildRuns([ev(), ev({ kind: "stop", at: at(12_000), finalMessageChars: 40 })], NOW);
    expect(run).toMatchObject({ state: "finished", durationMs: 12_000, finalMessageChars: 40 });
  });
  it("a start with no stop for a long time is 'no stop seen', never finished or failed", () => {
    const [run] = buildRuns([ev()], new Date(T0 + STALE_AFTER_MS + 1));
    expect(run?.state).toBe("no-stop-seen");
    expect(run?.durationMs).toBeUndefined();
  });
  it("a stop whose start was trimmed away is finished with no duration (nothing is invented)", () => {
    const [run] = buildRuns([ev({ kind: "stop" })], NOW);
    expect(run?.state).toBe("finished");
    expect(run?.durationMs).toBeUndefined();
    expect(run?.startedAt).toBeUndefined();
  });
  it("a stop recorded before its start gives no duration rather than a negative one", () => {
    const [run] = buildRuns([ev({ at: at(5000) }), ev({ kind: "stop", at: at(1000) })], NOW);
    expect(run?.durationMs).toBeUndefined();
  });
  it("parallel agents stay separate, newest first", () => {
    const runs = buildRuns([ev({ agentId: "a", at: at(0) }), ev({ agentId: "b", at: at(1000) }), ev({ agentId: "a", kind: "stop", at: at(2000) })], NOW);
    expect(runs.map((r) => [r.agentId, r.state])).toEqual([["b", "running"], ["a", "finished"]]);
  });
  it("no events gives no runs", () => {
    expect(buildRuns([], NOW)).toEqual([]);
  });
});

describe("buildMetrics", () => {
  const events = [
    ev({ agentId: "1", agentType: "Explore" }),
    ev({ agentId: "1", agentType: "Explore", kind: "stop", at: at(10_000) }),
    ev({ agentId: "2", agentType: "Explore" }),
    ev({ agentId: "2", agentType: "Explore", kind: "stop", at: at(30_000) }),
    ev({ agentId: "3", agentType: "Plan" }),
  ];
  it("counts by state and works out the median and longest only from finished runs with a duration", () => {
    const metrics = buildMetrics(buildRuns(events, NOW));
    const explore = metrics.find((m) => m.agentType === "Explore");
    expect(explore).toMatchObject({ runs: 2, finished: 2, running: 0, medianMs: 20_000, maxMs: 30_000, totalMs: 40_000 });
    const plan = metrics.find((m) => m.agentType === "Plan");
    expect(plan).toMatchObject({ runs: 1, running: 1, finished: 0 });
    expect(plan?.medianMs).toBeUndefined();
    expect(plan?.maxMs).toBeUndefined();
  });
  it("lists the most used type first", () => {
    expect(buildMetrics(buildRuns(events, NOW)).map((m) => m.agentType)).toEqual(["Explore", "Plan"]);
  });
  it("takes the median of an odd count as the middle value", () => {
    const odd = [1, 2, 3].flatMap((n) => [ev({ agentId: `${n}` }), ev({ agentId: `${n}`, kind: "stop", at: at(n * 1000) })]);
    expect(buildMetrics(buildRuns(odd, NOW))[0]?.medianMs).toBe(2000);
  });
  it("formats durations", () => {
    expect([850, 12_000, 185_000].map(formatDuration)).toEqual(["850 ms", "12 s", "3 min 05 s"]);
  });
});

describe("the agents screen", () => {
  const profile = (width: number) => resolveProfile(detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false, columns: width, rows: 40 }), defaultConfig().ui);
  const text = (width: number, events: AgentEvent[], now = NOW): string => {
    const runs = buildRuns(events, now);
    return agentsView(runs, buildMetrics(runs), now, profile(width)).map((l) => l.map((s) => s.text).join("")).join("\n");
  };
  it("says plainly that nothing is recorded, and invents nothing", () => {
    const out = text(100, []);
    expect(out).toContain("No agent activity has been recorded in this project.");
    expect(out).not.toMatch(/running|finished/i);
  });
  it("shows running and finished runs with the real times", () => {
    const out = text(110, [ev({ agentId: "run00001" }), ev({ agentId: "done0002", kind: "stop", at: at(12_000) }), ev({ agentId: "done0002", at: at(0) })]);
    expect(out).toContain("1 running, 2 recorded");
    expect(out).toContain("12 s");
    expect(out).toContain("run00001");
    expect(out).toMatch(/does not say|do not say whether/);
  });
  it("never claims success, failure, progress, cost or the task", () => {
    const full = text(110, [ev(), ev({ kind: "stop", at: at(5000), finalMessageChars: 10 })]).toLowerCase().replace(/\s+/g, " ");
    // The screen states, once, what it does not know; everything else must make no such claim.
    expect(full).toContain("do not say whether an agent's work was right, or whether it succeeded");
    const claims = full.replace("do not say whether an agent's work was right, or whether it succeeded", "").replace('does not call it failed', "");
    for (const word of ["succeed", "success rate", "failed", "progress", "tokens", "cost"]) expect(claims).not.toContain(word);
  });
  it("calls an old run with no stop 'no stop seen' and explains it", () => {
    const out = text(110, [ev()], new Date(T0 + STALE_AFTER_MS + 1000));
    expect(out).toContain("no stop seen");
    expect(out).toContain("does not call it failed");
  });
  it("a hostile agent type cannot inject escape sequences or break the layout", () => {
    const esc = String.fromCharCode(27);
    const out = text(80, [ev({ agentType: `${esc}[31mEvil${esc}]0;title\u0007` })]);
    expect(out).not.toContain(esc);
    expect(out).not.toContain("\u0007");
  });
  it("limits the table and says how many are hidden", () => {
    const many = Array.from({ length: SHOWN_RUNS + 3 }, (_, i) => ev({ agentId: `id${i}`, at: at(i * 1000) }));
    expect(text(110, many)).toContain("3 older runs are not shown.");
  });
  it.each([20, 40, 60, 80, 120, 200])("never overflows at %i columns", (width) => {
    const events = [ev({ agentType: "A very long agent type name indeed" }), ev({ kind: "stop", at: at(90_000), finalMessageChars: 5 })];
    const runs = buildRuns(events, NOW);
    for (const line of agentsView(runs, buildMetrics(runs), NOW, profile(width))) expect(lineWidth(line)).toBeLessThanOrEqual(width);
  });
  it("describes the summary in one sentence", () => {
    expect(agentsSentence(summarize([]))).toBe("No agent activity has been recorded in this project.");
    expect(agentsSentence({ running: 1, total: 3, noStopSeen: 1 })).toBe("1 running, 3 recorded, 1 with no stop seen");
  });
});

describe("recording and the command", () => {
  let base = "";
  let project = "";
  let tick = 0;
  const out: string[] = [];
  const makeCtx = (): CliContext =>
    createContext({
      cwd: project,
      out: (t) => void out.push(t),
      err: () => undefined,
      pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), PATH: "" }, homedir: base },
      git: async () => ({ exitCode: 128, stdout: "" }),
      now: () => new Date(T0 + ++tick * 1000),
      terminal: () => ({ isTTY: false, columns: undefined, rows: undefined }),
    });
  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "jpe-agents-"));
    project = path.join(base, "proj");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "package.json"), "{}");
    out.length = 0;
    tick = 0;
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const common = (name: string, extra: Record<string, unknown>) => ({ session_id: "sess-1", cwd: project, hook_event_name: name, ...extra });

  it("the start and stop handlers record real events, with no output and no task text", async () => {
    const ctx = makeCtx();
    const startOut = await onSubagentStart(parsePayload("SubagentStart", JSON.stringify(common("SubagentStart", { agent_id: "ag1", agent_type: "Explore", prompt: "SECRET TASK TEXT" }))), ctx);
    const stopOut = await onSubagentStop(parsePayload("SubagentStop", JSON.stringify(common("SubagentStop", { agent_id: "ag1", agent_type: "Explore", last_assistant_message: "private words here" }))), ctx);
    expect(startOut).toBeUndefined();
    expect(stopOut).toBeUndefined();
    const raw = await readFile(path.join(ctx.stateDir(), AGENT_EVENTS_FILE), "utf8");
    expect(raw).not.toContain("SECRET TASK TEXT");
    expect(raw).not.toContain("private words here");
    const events = await loadAgentEvents(ctx);
    expect(events.map((e) => e.kind)).toEqual(["start", "stop"]);
    expect(events[1]?.finalMessageChars).toBe("private words here".length);
  });

  it("the hook runner accepts both events, and ignores a payload with no agent id", async () => {
    const ctx = makeCtx();
    const deps = (input: unknown) => ({ readStdin: async () => JSON.stringify(input), makeContext: () => ctx, write: () => undefined, deadlineMs: 5000, debug: false });
    await runHook("SubagentStart", deps(common("SubagentStart", { agent_id: "ag9", agent_type: "Plan" })));
    await runHook("SubagentStart", deps(common("SubagentStart", { agent_type: "Plan" })));
    expect((await loadAgentEvents(ctx)).map((e) => e.agentId)).toEqual(["ag9"]);
  });

  it("parallel agents reporting together lose no event", async () => {
    const ctx = makeCtx();
    await Promise.all(Array.from({ length: 25 }, (_, i) => onSubagentStart(parsePayload("SubagentStart", JSON.stringify(common("SubagentStart", { agent_id: `p${i}`, agent_type: "Explore" }))), ctx)));
    expect(await loadAgentEvents(ctx)).toHaveLength(25);
  });

  it("a missing or damaged record reads as no events", async () => {
    const ctx = makeCtx();
    expect(await loadAgentEvents(ctx)).toEqual([]);
    await mkdir(ctx.stateDir(), { recursive: true });
    await writeFile(path.join(ctx.stateDir(), AGENT_EVENTS_FILE), "\u0000\u0001 not json\n");
    expect(await loadAgentEvents(ctx)).toEqual([]);
  });

  it("pruning trims an oversized record and leaves a small one alone", async () => {
    const ctx = makeCtx();
    await mkdir(ctx.stateDir(), { recursive: true });
    const file = path.join(ctx.stateDir(), AGENT_EVENTS_FILE);
    const small = serializeAgentEvent(ev());
    await writeFile(file, small);
    await pruneAgentEvents(ctx);
    expect(await readFile(file, "utf8")).toBe(small);
    await writeFile(file, Array.from({ length: MAX_AGENT_EVENTS + 200 }, (_, i) => serializeAgentEvent(ev({ agentId: `a${i}` }))).join(""));
    await pruneAgentEvents(ctx);
    expect(parseAgentEvents(await readFile(file, "utf8"))).toHaveLength(MAX_AGENT_EVENTS);
  });

  it("`jpe agents` shows real recorded runs, and `--json` has the same facts", async () => {
    const ctx = makeCtx();
    await onSubagentStart(parsePayload("SubagentStart", JSON.stringify(common("SubagentStart", { agent_id: "ag1", agent_type: "Explore" }))), ctx);
    await onSubagentStop(parsePayload("SubagentStop", JSON.stringify(common("SubagentStop", { agent_id: "ag1", agent_type: "Explore" }))), ctx);
    expect(await runCli(["agents", "--width", "100"], makeCtx())).toBe(0);
    expect(out.join("\n")).toContain("Explore");
    out.length = 0;
    expect(await runCli(["agents", "--json"], makeCtx())).toBe(0);
    const json = JSON.parse(out.join("\n"));
    expect(json.runs).toHaveLength(1);
    expect(json.runs[0]).toMatchObject({ agentType: "Explore", state: "finished" });
    expect(json.metrics[0]).toMatchObject({ agentType: "Explore", runs: 1, finished: 1 });
  });

  it("`jpe agents` on a project with no record says so", async () => {
    expect(await runCli(["agents"], makeCtx())).toBe(0);
    expect(out.join("\n")).toContain("No agent activity has been recorded");
  });
});

describe("the command center's agents facts", () => {
  const base = {
    hudVersion: 1,
    generatedAt: "2026-03-04T12:00:00.000Z",
    project: { name: "p", ecosystems: [] },
    git: { state: "not-repo" },
    verification: { status: "NOT_TESTED", reasons: [], checksAvailable: [] },
    languageServersMissing: [],
    runtime: { offline: false, approval: "risk-based" },
  };
  it("reads valid agents facts and refuses malformed ones", async () => {
    const { parseHud } = await import("../../src/center/hud-data.js");
    expect(parseHud({ ...base, agents: { running: 1, total: 3, noStopSeen: 0 } })?.agents).toEqual({ running: 1, total: 3, noStopSeen: 0 });
    expect(parseHud(base)?.agents).toBeUndefined();
    for (const bad of [{ running: -1, total: 1, noStopSeen: 0 }, { running: 1.5, total: 1, noStopSeen: 0 }, { running: "1", total: 1, noStopSeen: 0 }, { running: 1, total: 1 }, [], null]) {
      expect(parseHud({ ...base, agents: bad }), JSON.stringify(bad)).toBeUndefined();
    }
  });
  it("the home screen shows an Agents row only when events were recorded", async () => {
    const { hudLines } = await import("../../src/center/home.js");
    const p = resolveProfile(detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false, columns: 100, rows: 40 }), defaultConfig().ui);
    const flat = (agents?: { running: number; total: number; noStopSeen: number }): string =>
      hudLines({ ...(base as unknown as HudData), ...(agents === undefined ? {} : { agents }) }, p, NOW).map((l) => l.map((s) => s.text).join("")).join("\n");
    expect(flat()).not.toContain("Agents");
    expect(flat({ running: 2, total: 5, noStopSeen: 1 })).toContain("2 running, 5 recorded, 1 with no stop seen");
  });
  it("collectHud reports real recorded runs and nothing when there are none", async () => {
    const { collectHud } = await import("../../src/center/hud.js");
    const dir = await mkdtemp(path.join(tmpdir(), "jpe-agents-hud-"));
    try {
      const project = path.join(dir, "p");
      await mkdir(project, { recursive: true });
      await writeFile(path.join(project, "package.json"), "{}");
      const ctx = createContext({ cwd: project, pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(dir, "data"), PATH: "" }, homedir: dir }, git: async () => ({ exitCode: 128, stdout: "" }), now: () => new Date(T0 + 1000) });
      expect((await collectHud(ctx)).agents).toBeUndefined();
      await mkdir(ctx.stateDir(), { recursive: true });
      await writeFile(path.join(ctx.stateDir(), AGENT_EVENTS_FILE), serializeAgentEvent(ev({ at: at(0) })));
      expect((await collectHud(ctx)).agents).toEqual({ running: 1, total: 1, noStopSeen: 0 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

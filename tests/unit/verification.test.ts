import { describe, expect, it } from "vitest";
import { JpeError } from "../../src/core/errors.js";
import { EvidenceLedger } from "../../src/core/ledger.js";
import { deriveStatus } from "../../src/core/status.js";
import type { DiscoveredCheck } from "../../src/project/checks.js";
import { runCommand, type RunOptions, type RunResult } from "../../src/security/run.js";
import { repairLoop } from "../../src/verification/repair.js";
import { captureBaseline, failureSignature, findRegressions, runChecks, type RunnerDeps } from "../../src/verification/runner.js";

const check = (name: DiscoveredCheck["check"], display: string): DiscoveredCheck => ({
  check: name,
  file: display.split(" ")[0] ?? display,
  args: display.split(" ").slice(1),
  source: "script",
  display,
});
const TEST = check("unit-test", "t test");
const BUILD = check("build", "t build");

const ok = (stdout = ""): RunResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false, truncated: false, durationMs: 1 });
const fail = (stderr = "boom", exitCode = 1): RunResult => ({ exitCode, stdout: "", stderr, timedOut: false, truncated: false, durationMs: 1 });

function newLedger(): EvidenceLedger {
  let n = 0;
  return new EvidenceLedger({ now: () => new Date("2026-01-01T00:00:00Z"), newId: () => `e${++n}` });
}

/** Scripted runner: each command pops its next result; the last one repeats. */
function scripted(script: Record<string, Array<RunResult | Error>>): { run: RunnerDeps["run"]; calls: string[] } {
  const calls: string[] = [];
  const run = async (o: RunOptions): Promise<RunResult> => {
    const key = [o.file, ...o.args].join(" ");
    calls.push(key);
    const queue = script[key];
    if (!queue || queue.length === 0) throw new Error(`unscripted command: ${key}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next as RunResult;
  };
  return { run, calls };
}

function deps(run: RunnerDeps["run"]): RunnerDeps {
  return { run, ledger: newLedger(), cwd: ".", timeoutMs: 1000 };
}

describe("runChecks", () => {
  it("records real exit codes and derives status from them", async () => {
    const d = deps(scripted({ "t test": [ok("3 passed")], "t build": [fail("TS2304")] }).run);
    const out = await runChecks([TEST, BUILD], d);
    expect(out.map((o) => o.state)).toEqual(["passed", "failed"]);
    expect(deriveStatus(d.ledger.entries, ["unit-test", "build"]).status).toBe("FAILED");
  });

  it("records a missing tool as not-run, never as a pass", async () => {
    const missing = new JpeError("TOOL_UNAVAILABLE", 'Could not start "t".');
    const d = deps(scripted({ "t test": [missing] }).run);
    const out = await runChecks([TEST], d);
    expect(out[0]?.state).toBe("unavailable");
    expect(deriveStatus(d.ledger.entries, ["unit-test"]).status).toBe("NOT_TESTED");
  });

  it("propagates unexpected (non-JPE) errors instead of hiding them", async () => {
    const d = deps(scripted({ "t test": [new TypeError("bug")] }).run);
    await expect(runChecks([TEST], d)).rejects.toThrow(TypeError);
  });

  it("parses warning counts and marks timeouts", async () => {
    const d = deps(scripted({ "t test": [ok("done with 4 warnings")], "t build": [{ ...fail(), timedOut: true }] }).run);
    const out = await runChecks([TEST, BUILD], d);
    expect(out[1]?.state).toBe("timed-out");
    expect(deriveStatus(d.ledger.entries, ["unit-test"]).status).toBe("FUNCTIONAL_WITH_WARNINGS");
  });

  it("actually executes a real process end to end", async () => {
    const real = check("unit-test", `${process.execPath} -e process.exit(0)`);
    const realCheck: DiscoveredCheck = { ...real, file: process.execPath, args: ["-e", "process.exit(0)"] };
    const d: RunnerDeps = { run: runCommand, ledger: newLedger(), cwd: process.cwd(), timeoutMs: 10_000 };
    await runChecks([realCheck], d);
    expect(deriveStatus(d.ledger.entries, ["unit-test"]).status).toBe("VERIFIED");
  });
});

describe("baseline and regressions", () => {
  it("labels failures that existed before the change as pre-existing", async () => {
    const s = scripted({ "t test": [fail("old failure")], "t build": [ok()] });
    const baseline = await captureBaseline([TEST, BUILD], { run: s.run, cwd: ".", timeoutMs: 1000 });
    const d = deps(s.run);
    const out = await runChecks([TEST, BUILD], d, baseline);
    expect(out[0]).toMatchObject({ state: "failed", preexisting: true });
    expect(deriveStatus(d.ledger.entries, ["unit-test", "build"]).status).toBe("FUNCTIONAL_WITH_WARNINGS");
  });

  it("flags a check that passed before and fails now as a regression", async () => {
    const before = scripted({ "t test": [ok()], "t build": [ok()] });
    const baseline = await captureBaseline([TEST, BUILD], { run: before.run, cwd: ".", timeoutMs: 1000 });
    const after = scripted({ "t test": [ok()], "t build": [fail()] });
    const out = await runChecks([TEST, BUILD], deps(after.run), baseline);
    expect(findRegressions(baseline, out).map((o) => o.display)).toEqual(["t build"]);
  });
});

describe("repairLoop", () => {
  const base = { now: () => 0, deadlineMs: 1000 };
  const noFix = async () => ({ changed: false, summary: "" });

  it("reports passed without calling the repairer when nothing fails", async () => {
    const s = scripted({ "t test": [ok()] });
    let called = false;
    const r = await repairLoop({ ...base, checks: [TEST], deps: deps(s.run), maxAttempts: 3, repair: async () => ((called = true), { changed: true, summary: "" }) });
    expect(r).toMatchObject({ outcome: "passed", attempts: 0 });
    expect(called).toBe(false);
  });

  it("fixes after a repair and re-runs everything as the regression check", async () => {
    const s = scripted({ "t test": [fail("a"), ok(), ok()], "t build": [ok()] });
    const r = await repairLoop({ ...base, checks: [TEST, BUILD], deps: deps(s.run), maxAttempts: 3, repair: async () => ({ changed: true, summary: "fix a" }) });
    expect(r).toMatchObject({ outcome: "fixed", attempts: 1 });
    expect(r.history[0]).toMatchObject({ attempt: 1, failing: ["t test"], summary: "fix a" });
    expect(s.calls.filter((c) => c === "t build")).toHaveLength(2); // initial run + full regression pass
  });

  it("catches a regression introduced by a repair and keeps going", async () => {
    const s = scripted({ "t test": [fail("a"), ok()], "t build": [ok(), fail("new breakage"), ok()] });
    let attempt = 0;
    const r = await repairLoop({ ...base, checks: [TEST, BUILD], deps: deps(s.run), maxAttempts: 4, repair: async () => ({ changed: true, summary: `try ${++attempt}` }) });
    expect(r.outcome).toBe("fixed");
    expect(r.attempts).toBe(2);
  });

  it("stops at the attempt limit", async () => {
    let n = 0;
    const run = async (): Promise<RunResult> => fail(`distinct failure ${"x".repeat(++n)}`);
    const r = await repairLoop({ ...base, checks: [TEST], deps: deps(run), maxAttempts: 2, repair: async () => ({ changed: true, summary: "" }) });
    expect(r).toMatchObject({ outcome: "exhausted", attempts: 2 });
  });

  it("stops when the same failure returns after a change (stalled)", async () => {
    const s = scripted({ "t test": [fail("same error 42")] });
    const r = await repairLoop({ ...base, checks: [TEST], deps: deps(s.run), maxAttempts: 10, repair: async () => ({ changed: true, summary: "" }) });
    expect(r).toMatchObject({ outcome: "stalled", attempts: 1 });
  });

  it("stops when the repairer makes no change", async () => {
    const s = scripted({ "t test": [fail()] });
    const r = await repairLoop({ ...base, checks: [TEST], deps: deps(s.run), maxAttempts: 5, repair: noFix });
    expect(r.outcome).toBe("no-fix");
  });

  it("honours the deadline", async () => {
    let t = 0;
    const s = scripted({ "t test": [fail()] });
    const r = await repairLoop({ checks: [TEST], deps: deps(s.run), maxAttempts: 5, deadlineMs: 100, now: () => (t += 200), repair: noFix });
    expect(r).toMatchObject({ outcome: "deadline", attempts: 0 });
  });

  it("never repairs pre-existing failures or unavailable tools", async () => {
    const s = scripted({ "t test": [fail("old")], "t build": [new JpeError("TOOL_UNAVAILABLE", "missing")] });
    const baseline = await captureBaseline([TEST], { run: s.run, cwd: ".", timeoutMs: 1000 });
    let called = false;
    const r = await repairLoop({ ...base, checks: [TEST, BUILD], deps: deps(s.run), baseline, maxAttempts: 3, repair: async () => ((called = true), { changed: true, summary: "" }) });
    expect(r.outcome).toBe("passed");
    expect(called).toBe(false);
  });
});

describe("failure fingerprints", () => {
  it("ignore timings even when a number gains a digit (regression: the window used to shift)", () => {
    const body = "x".repeat(420);
    expect(failureSignature(`${body}
# duration_ms 99.1
# fail 1`)).toBe(failureSignature(`${body}
# duration_ms 1005.4427
# fail 1`));
  });
  it("still tell different failures apart", () => {
    expect(failureSignature("not ok - legacy formatting")).not.toBe(failureSignature("not ok - legacy formatting\nnot ok - withDiscount"));
  });
  it("the repair loop treats an identical failure with a longer timing as stalled", async () => {
    const outputs = ["x".repeat(500) + " duration_ms 99.1 FAIL add", "x".repeat(500) + " duration_ms 1005.44 FAIL add"];
    let i = 0;
    const run = async (): Promise<RunResult> => fail(outputs[Math.min(i++, 1)] ?? "");
    let calls = 0;
    const r = await repairLoop({ now: () => 0, deadlineMs: 1000, checks: [TEST], deps: deps(run), maxAttempts: 5, repair: async () => (calls++, { changed: true, summary: "" }) });
    expect(r.outcome).toBe("stalled");
    expect(calls).toBe(1);
  });
});

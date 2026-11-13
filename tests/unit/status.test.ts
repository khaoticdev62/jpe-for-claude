import { describe, expect, it } from "vitest";
import { JpeError } from "../../src/core/errors.js";
import { MAX_EXCERPT_CHARS, EvidenceLedger, parseEvidenceLines } from "../../src/core/ledger.js";
import { deriveStatus } from "../../src/core/status.js";

function makeLedger(): EvidenceLedger {
  let n = 0;
  return new EvidenceLedger({ now: () => new Date("2026-01-01T00:00:00Z"), newId: () => `e${++n}` });
}
const run = (l: EvidenceLedger, check: "typecheck" | "unit-test" | "build" | "lint", exitCode = 0, extra = {}): void => {
  l.recordCommand({ check, command: `run ${check}`, exitCode, durationMs: 5, ...extra });
};

describe("deriveStatus", () => {
  it("is NOT_TESTED with no evidence or no applicable checks", () => {
    const l = makeLedger();
    expect(deriveStatus(l.entries, ["unit-test"]).status).toBe("NOT_TESTED");
    run(l, "unit-test");
    expect(deriveStatus(l.entries, []).status).toBe("NOT_TESTED");
  });

  it("is VERIFIED only when every required check passed", () => {
    const l = makeLedger();
    run(l, "typecheck");
    run(l, "unit-test");
    const report = deriveStatus(l.entries, ["typecheck", "unit-test"]);
    expect(report.status).toBe("VERIFIED");
    expect(report.checks).toEqual({ typecheck: "passed", "unit-test": "passed" });
  });

  it("is PARTIALLY_VERIFIED when a required check never ran, and cites the not-run reason", () => {
    const l = makeLedger();
    run(l, "typecheck");
    l.recordNotRun("unit-test", "no test script found");
    const report = deriveStatus(l.entries, ["typecheck", "unit-test"]);
    expect(report.status).toBe("PARTIALLY_VERIFIED");
    expect(report.reasons.join(" ")).toContain("no test script found");
  });

  it("is FAILED on a non-zero exit or timeout", () => {
    const l = makeLedger();
    run(l, "build", 1);
    expect(deriveStatus(l.entries, ["build"]).status).toBe("FAILED");
    const t = makeLedger();
    run(t, "build", 0, { timedOut: true });
    expect(deriveStatus(t.entries, ["build"]).reasons[0]).toContain("timed out");
  });

  it("lets a passing re-run supersede an earlier failure", () => {
    const l = makeLedger();
    run(l, "unit-test", 1);
    run(l, "unit-test", 0);
    expect(deriveStatus(l.entries, ["unit-test"]).status).toBe("VERIFIED");
  });

  it("downgrades to FUNCTIONAL_WITH_WARNINGS for lint warnings, pre-existing failures and missing LSP", () => {
    const a = makeLedger();
    run(a, "lint", 0, { warnings: 3 });
    expect(deriveStatus(a.entries, ["lint"]).status).toBe("FUNCTIONAL_WITH_WARNINGS");

    const b = makeLedger();
    run(b, "unit-test", 1, { preexisting: true });
    const rb = deriveStatus(b.entries, ["unit-test"]);
    expect(rb.status).toBe("FUNCTIONAL_WITH_WARNINGS");
    expect(rb.checks["unit-test"]).toBe("failed-preexisting");

    const c = makeLedger();
    run(c, "typecheck");
    c.recordLsp({ server: "tsserver", available: false, errors: 0, warnings: 0 });
    expect(deriveStatus(c.entries, ["typecheck"]).status).toBe("FUNCTIONAL_WITH_WARNINGS");
  });

  it("never counts an unavailable LSP as proof", () => {
    const l = makeLedger();
    l.recordLsp({ server: "gopls", available: false, errors: 0, warnings: 0 });
    expect(deriveStatus(l.entries, ["typecheck"]).status).toBe("NOT_TESTED");
  });

  it("fails on LSP errors and blocks on blockers (blocker wins)", () => {
    const l = makeLedger();
    run(l, "typecheck");
    l.recordLsp({ server: "tsserver", available: true, errors: 2, warnings: 0 });
    expect(deriveStatus(l.entries, ["typecheck"]).status).toBe("FAILED");
    l.recordBlocker("missing API credential");
    expect(deriveStatus(l.entries, ["typecheck"]).status).toBe("BLOCKED");
  });
});

describe("EvidenceLedger", () => {
  it("redacts secrets and truncates long output to its tail", () => {
    const l = makeLedger();
    const long = `${"x".repeat(5000)} FAIL token=abcdef123456`;
    const entry = l.recordCommand({ check: "build", command: "build", exitCode: 1, durationMs: 1, output: long });
    if (entry.kind !== "command") throw new Error("unexpected kind");
    expect(entry.outputExcerpt).not.toContain("abcdef123456");
    expect(entry.outputExcerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 3);
    expect(entry.outputExcerpt).toContain("FAIL");
  });

  it("rejects malformed evidence and freezes entries", () => {
    const l = makeLedger();
    expect(() => l.recordCommand({ check: "build", command: "b", exitCode: 1.5, durationMs: 1 })).toThrow(JpeError);
    expect(() => l.recordBlocker("")).toThrow(JpeError);
    const e = l.recordNotRun("lint", "skipped");
    expect(Object.isFrozen(e)).toBe(true);
  });

  it("round-trips through JSON lines and rejects tampered lines", () => {
    const l = makeLedger();
    run(l, "build");
    l.recordBlocker("needs approval");
    const text = l.toJsonLines();
    expect(parseEvidenceLines(text)).toEqual([...l.entries]);
    expect(() => parseEvidenceLines('{"kind":"command","check":"build"}')).toThrow(/failed validation/);
    expect(() => parseEvidenceLines("not json")).toThrow(/not valid JSON/);
  });
});

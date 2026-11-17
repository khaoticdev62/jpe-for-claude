import { describe, expect, it } from "vitest";
import { summarizeChange } from "../../src/explain/diff.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { decisionLines, reviewView, type ReviewFile } from "../../src/show/explain-views.js";
import { parseReviewData, type ReviewData, type ReviewDecisionState } from "../../src/show/review-data.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { type Line, lineText } from "../../src/ui/doc.js";
import { resolveProfile, type UiSettings } from "../../src/ui/profile.js";

const profile = (width = 100, settings: Partial<UiSettings> = {}) => resolveProfile(detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false, columns: width, rows: 40 }), { ...defaultConfig().ui, ...settings });
const text = (lines: readonly Line[]): string => lines.map(lineText).join("\n");

const file = (name: string, before: string, after: string): ReviewFile => ({ summary: summarizeChange(name, before, after), status: "modified", isTest: false });
const data = (over: Partial<ReviewData> = {}): ReviewData => ({
  files: [file("src/a.js", "a\n", "a\neval(x)\n")],
  notes: [{ basis: "confirmed", text: "src/a.js:2 introduces a possible high risk" }, { basis: "heuristic", text: "no tests changed" }],
  checklist: ["Read each diff"],
  skipped: [],
  ...over,
});
const roundTrip = (d: ReviewData): unknown => JSON.parse(JSON.stringify(d));

describe("parseReviewData", () => {
  it("accepts exactly what jpe show review --json produces, with and without a decision", () => {
    expect(parseReviewData(roundTrip(data()))).toEqual(data());
    for (const decision of [{ state: "none", fileCount: 2 }, { state: "current", fileCount: 2, decision: "approved", at: "2026-03-04T12:00:00.000Z", note: "ok" }, { state: "stale", fileCount: 1, decision: "rejected" }] as const) {
      expect(parseReviewData(roundTrip(data({ decision: decision as ReviewDecisionState })))).toBeDefined();
    }
  });
  it("accepts an empty review", () => {
    expect(parseReviewData({ files: [], notes: [], checklist: [], skipped: [] })).toBeDefined();
  });
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "x"],
    ["an array", []],
    ["files that are not a list", { files: "no", notes: [], checklist: [], skipped: [] }],
    ["a file with an unknown status", { ...roundTrip(data()) as object, files: [{ status: "renamed", isTest: false, summary: data().files[0]?.summary }] }],
    ["a file whose isTest is text", { ...roundTrip(data()) as object, files: [{ status: "modified", isTest: "no", summary: data().files[0]?.summary }] }],
    ["a summary with no hunks list", { ...roundTrip(data()) as object, files: [{ status: "modified", isTest: false, summary: { file: "a", added: 1, removed: 0, unchanged: 0 } }] }],
    ["a hunk with text line numbers", { ...roundTrip(data()) as object, files: [{ status: "modified", isTest: false, summary: { ...data().files[0]?.summary, hunks: [{ beforeStart: "1", afterStart: 1, removed: [], added: [] }] } }] }],
    ["a risk with an unknown severity", { ...roundTrip(data()) as object, files: [{ status: "modified", isTest: false, summary: { ...data().files[0]?.summary, risksIntroduced: [{ id: "x", line: 1, severity: "critical", message: "m" }] } }] }],
    ["a note with an unknown basis", { ...roundTrip(data()) as object, notes: [{ basis: "guess", text: "x" }] }],
    ["a checklist that is not text", { ...roundTrip(data()) as object, checklist: [1] }],
    ["an unknown decision state", { ...roundTrip(data()) as object, decision: { state: "approved", fileCount: 1 } }],
    ["a decision with a negative count", { ...roundTrip(data()) as object, decision: { state: "none", fileCount: -1 } }],
    ["a decision with an unknown value", { ...roundTrip(data()) as object, decision: { state: "current", fileCount: 1, decision: "maybe" } }],
  ])("rejects %s", (_name, value) => {
    expect(parseReviewData(value)).toBeUndefined();
  });
  it("never throws on odd input", () => {
    for (const odd of [{}, { files: [null] }, { files: [{}] }, { files: [{ summary: null }] }, "{", 0, true, Object.create(null)]) expect(() => parseReviewData(odd)).not.toThrow();
  });
});

describe("decisionLines: a decision is never described as stronger than it is", () => {
  const lines = (d: ReviewDecisionState, settings: Partial<UiSettings> = {}): string => text(decisionLines(d, profile(100, settings)));
  it("says nothing was decided", () => {
    expect(lines({ state: "none", fileCount: 3 })).toBe("○ No review decision recorded for these changes");
  });
  it("shows a current approval and a current rejection with different glyphs and words", () => {
    expect(lines({ state: "current", fileCount: 3, decision: "approved" })).toBe("✔ Approved, and these changes are unchanged since");
    expect(lines({ state: "current", fileCount: 3, decision: "rejected" })).toBe("✘ Rejected, and these changes are unchanged since");
  });
  it("shows a stale decision as stale, naming the old decision, and never as approved-and-current", () => {
    const out = lines({ state: "stale", fileCount: 3, decision: "approved" });
    expect(out).toContain("▲ Stale: the last decision (approved) was about different changes than these");
    expect(out).not.toContain("unchanged since");
  });
  it("shows the note, and reads in words for a screen reader", () => {
    expect(lines({ state: "current", fileCount: 1, decision: "approved", note: "checked by hand" })).toContain("Note: checked by hand");
    expect(lines({ state: "current", fileCount: 1, decision: "approved" }, { screenReader: true })).toBe("OK: Approved, and these changes are unchanged since");
  });
});

describe("the review screen includes the decision when known", () => {
  it("puts it right under the heading, before the overview", () => {
    const out = text(reviewView(data().files, profile(), { expanded: false, maxHunkLines: 40, skipped: [], decision: { state: "stale", fileCount: 1, decision: "approved" } }));
    expect(out.indexOf("Stale")).toBeGreaterThan(out.indexOf("Code review of uncommitted changes"));
    expect(out.indexOf("Stale")).toBeLessThan(out.indexOf("1 file changed"));
  });
  it("leaves it out when the decision could not be determined", () => {
    expect(text(reviewView(data().files, profile(), { expanded: false, maxHunkLines: 40, skipped: [] }))).not.toContain("decision");
  });
});

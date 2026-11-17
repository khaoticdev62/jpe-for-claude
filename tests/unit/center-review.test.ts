import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { buildHome, hudLines } from "../../src/center/home.js";
import { collectHud } from "../../src/center/hud.js";
import { type HudData, parseHud, type ReviewSummary } from "../../src/center/hud-data.js";
import { EMPTY_MEMORY } from "../../src/center/memory.js";
import { notifications, suggest } from "../../src/center/suggestions.js";
import { appendDecision, type ReviewDecision } from "../../src/review/decisions.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { type Line, lineText } from "../../src/ui/doc.js";
import { resolveProfile } from "../../src/ui/profile.js";

const NOW = new Date("2026-03-04T12:00:00.000Z");
const text = (lines: readonly Line[]): string => lines.map(lineText).join("\n");
const profile = (width = 100) => resolveProfile(detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false, columns: width, rows: 40 }), defaultConfig().ui);

const hud = (review?: ReviewSummary): HudData => ({
  hudVersion: 1,
  generatedAt: NOW.toISOString(),
  project: { name: "demo", ecosystems: ["node"], packageManager: "npm" },
  git: { state: "clean", branch: "main" },
  verification: { status: "VERIFIED", at: "2026-03-04T11:50:00.000Z", reasons: [], checksAvailable: ["unit-test"] },
  languageServersMissing: [],
  runtime: { offline: false, approval: "risk-based" },
  ...(review === undefined ? {} : { review }),
});

describe("parseHud: the review field", () => {
  it("accepts a HUD with no review, and every valid review shape", () => {
    expect(parseHud(hud())).toBeDefined();
    for (const review of [{ changedFiles: 0, state: "none" }, { changedFiles: 3, state: "current", decision: "approved", at: NOW.toISOString() }, { changedFiles: 1, state: "stale", decision: "rejected", at: "x" }] as const) {
      expect(parseHud(hud(review as ReviewSummary))).toEqual(hud(review as ReviewSummary));
    }
  });
  it.each([
    ["not an object", "yes"],
    ["a negative count", { changedFiles: -1, state: "none" }],
    ["a fractional count", { changedFiles: 1.5, state: "none" }],
    ["a count that is text", { changedFiles: "2", state: "none" }],
    ["an unknown state", { changedFiles: 1, state: "approved" }],
    ["an unknown decision", { changedFiles: 1, state: "current", decision: "maybe" }],
    ["a time that is not text", { changedFiles: 1, state: "current", at: 5 }],
  ])("rejects a review that is %s", (_name, review) => {
    expect(parseHud({ ...hud(), review })).toBeUndefined();
  });
});

describe("review suggestions: each is a confirmed fact about the recorded decision", () => {
  const ids = (review?: ReviewSummary): string[] => suggest(hud(review)).map((s) => s.id);
  it("suggests nothing without a review summary, without changes, or when the current changes are approved", () => {
    expect(ids()).toEqual([]);
    expect(ids({ changedFiles: 0, state: "none" })).toEqual([]);
    expect(ids({ changedFiles: 0, state: "stale", decision: "approved", at: NOW.toISOString() })).toEqual([]);
    expect(ids({ changedFiles: 3, state: "current", decision: "approved", at: NOW.toISOString() })).toEqual([]);
  });
  it("suggests a first review when changes exist and nothing was decided", () => {
    const [s] = suggest(hud({ changedFiles: 2, state: "none" }));
    expect(s).toMatchObject({ id: "review-pending", commandId: "review", basis: "confirmed", level: "info" });
    expect(s?.why).toBe("2 uncommitted files, and no review decision has been recorded for them.");
    expect(suggest(hud({ changedFiles: 1, state: "none" }))[0]?.why).toContain("1 uncommitted file,");
  });
  it("suggests reviewing again when files changed since the last decision, and says what the old decision was", () => {
    const [s] = suggest(hud({ changedFiles: 4, state: "stale", decision: "approved", at: NOW.toISOString() }));
    expect(s).toMatchObject({ id: "review-stale", commandId: "review", basis: "confirmed" });
    expect(s?.why).toContain("The last decision (approved) was about different changes");
  });
  it("raises a rejected review of the current changes as a warning that notifies", () => {
    const review: ReviewSummary = { changedFiles: 2, state: "current", decision: "rejected", at: NOW.toISOString() };
    expect(suggest(hud(review))[0]).toMatchObject({ id: "review-rejected", level: "warning", basis: "confirmed" });
    expect(notifications(hud(review)).map((n) => n.id)).toEqual(["review-rejected"]);
  });
  it("never notifies for a pending or stale review, which are only suggestions to look", () => {
    expect(notifications(hud({ changedFiles: 2, state: "none" }))).toEqual([]);
    expect(notifications(hud({ changedFiles: 2, state: "stale", decision: "approved", at: NOW.toISOString() }))).toEqual([]);
  });
});

describe("the review row on the home screen", () => {
  const row = (review?: ReviewSummary): string => text(hudLines(hud(review), profile(), NOW));
  it("is absent when there is no review summary or no change to review", () => {
    expect(row()).not.toContain("Review");
    expect(row({ changedFiles: 0, state: "none" })).not.toContain("Review");
  });
  it("says in words where the review stands, and never calls a stale decision current", () => {
    expect(row({ changedFiles: 2, state: "none" })).toContain("no decision recorded for these changes");
    expect(row({ changedFiles: 2, state: "current", decision: "approved", at: "2026-03-04T11:55:00.000Z" })).toContain("approved 5 minutes ago, and the changes are unchanged since");
    const stale = row({ changedFiles: 2, state: "stale", decision: "approved", at: "2026-03-04T11:00:00.000Z" });
    expect(stale).toContain("last decision (approved 1 hour ago) is stale: files changed since");
    expect(stale).not.toContain("unchanged since");
  });
  it("puts the review next step on the numbered list, with its evidence", () => {
    const out = text(buildHome(hud({ changedFiles: 2, state: "none" }), EMPTY_MEMORY, profile(), NOW)).replace(/\s+/g, " ");
    expect(out).toContain("1. /jpe:review");
    expect(out).toContain("2 uncommitted files, and no review decision has been recorded for them. (confirmed)");
  });
});

describe("collectHud reads the real decision state", () => {
  let base = "";
  let project = "";
  let porcelain = "";
  const git = async (args: readonly string[]): Promise<{ exitCode: number; stdout: string }> => {
    if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { exitCode: 0, stdout: "true\n" };
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { exitCode: 0, stdout: `${project}\n` };
    if (args[0] === "symbolic-ref") return { exitCode: 0, stdout: "main\n" };
    if (args[0] === "status") return { exitCode: 0, stdout: porcelain };
    return { exitCode: 128, stdout: "" };
  };
  const ctxFor = (over: Partial<CliContext> = {}): CliContext =>
    createContext({ cwd: project, pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), PATH: "" }, homedir: base }, git, now: () => NOW, ...over });

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "jpe-hudreview-"));
    project = path.join(base, "proj");
    await mkdir(project);
    await writeFile(path.join(project, "a.js"), "one\n");
    porcelain = " M a.js\0";
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("reports no decision, then a current approval, then a stale one once the file changes", async () => {
    expect((await collectHud(ctxFor())).review).toEqual({ changedFiles: 1, state: "none" });

    const { reviewFingerprint } = await import("../../src/review/changes.js");
    const ctx = ctxFor();
    const { fingerprint, fileCount } = await reviewFingerprint(ctx);
    const decision: ReviewDecision = { id: "d1", at: "2026-03-04T11:58:00.000Z", decision: "approved", fingerprint, fileCount };
    await ctx.writeText(path.join(ctx.stateDir(), "reviews.jsonl"), appendDecision([], decision));
    expect((await collectHud(ctxFor())).review).toEqual({ changedFiles: 1, state: "current", decision: "approved", at: "2026-03-04T11:58:00.000Z" });

    await writeFile(path.join(project, "a.js"), "two\n");
    expect((await collectHud(ctxFor())).review).toMatchObject({ state: "stale", decision: "approved" });
  });

  it("leaves the review out when this is not a git repository", async () => {
    const hudNoGit = await collectHud(ctxFor({ git: async () => ({ exitCode: 128, stdout: "" }) }));
    expect(hudNoGit.review).toBeUndefined();
    expect(Object.keys(hudNoGit)).not.toContain("review");
  });

  it("reads a damaged decisions file as no decision", async () => {
    const ctx = ctxFor();
    await ctx.writeText(path.join(ctx.stateDir(), "reviews.jsonl"), "garbage\n");
    expect((await collectHud(ctxFor())).review).toEqual({ changedFiles: 1, state: "none" });
  });
});

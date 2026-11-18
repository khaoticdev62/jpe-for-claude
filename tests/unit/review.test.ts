import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { COMMAND_NAMES, runCli } from "../../src/cli/main.js";
import { reviewFingerprint } from "../../src/review/changes.js";
import { appendDecision, cleanNote, decisionState, MAX_NOTE_CHARS, MAX_RECORDS, parseDecision, parseDecisions, type ReviewDecision } from "../../src/review/decisions.js";

const ESC = "\u001b";
const FP = "a".repeat(64);
const FP2 = "b".repeat(64);

const decision = (over: Partial<ReviewDecision> = {}): ReviewDecision => ({ id: "d1", at: "2026-03-04T12:00:00.000Z", decision: "approved", fingerprint: FP, fileCount: 2, ...over });

describe("parseDecision", () => {
  it("reads a valid record, with and without a note", () => {
    expect(parseDecision(JSON.stringify(decision()))).toEqual(decision());
    expect(parseDecision(JSON.stringify(decision({ note: "looks fine" })))?.note).toBe("looks fine");
  });
  it("drops an empty note and cuts an over-long one", () => {
    expect(parseDecision(JSON.stringify({ ...decision(), note: "" }))).toEqual(decision());
    expect(parseDecision(JSON.stringify(decision({ note: "x".repeat(2000) })))?.note).toHaveLength(MAX_NOTE_CHARS);
  });
  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["null", "null"],
    ["a number", "7"],
    ["no id", JSON.stringify({ ...decision(), id: undefined })],
    ["an empty id", JSON.stringify(decision({ id: "" }))],
    ["a very long id", JSON.stringify(decision({ id: "x".repeat(100) }))],
    ["a bad time", JSON.stringify(decision({ at: "yesterday" }))],
    ["an unknown decision", JSON.stringify({ ...decision(), decision: "maybe" })],
    ["a short fingerprint", JSON.stringify(decision({ fingerprint: "abc" }))],
    ["an upper-case fingerprint", JSON.stringify(decision({ fingerprint: "A".repeat(64) }))],
    ["a negative count", JSON.stringify(decision({ fileCount: -1 }))],
    ["a fractional count", JSON.stringify(decision({ fileCount: 1.5 }))],
    ["a count that is text", JSON.stringify({ ...decision(), fileCount: "2" })],
    ["a note that is not text", JSON.stringify({ ...decision(), note: 5 })],
  ])("rejects %s", (_name, line) => {
    expect(parseDecision(line)).toBeUndefined();
  });
  it("never throws, whatever it is given", () => {
    for (const junk of ["", " ", "\u0000", "💥", "{".repeat(10_000), '{"id":', "{\"__proto__\":{\"polluted\":true}}"]) expect(() => parseDecision(junk)).not.toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("parseDecisions and appendDecision", () => {
  it("skips blank and damaged lines and keeps the valid ones in order", () => {
    const text = [JSON.stringify(decision({ id: "a" })), "", "garbage", JSON.stringify(decision({ id: "b", decision: "rejected" })), "{}"].join("\n");
    expect(parseDecisions(text).map((d) => d.id)).toEqual(["a", "b"]);
    expect(parseDecisions("")).toEqual([]);
    expect(parseDecisions("\r\n\r\n")).toEqual([]);
  });
  it("round-trips, and drops damaged lines when it rewrites", () => {
    const stored = appendDecision([decision({ id: "a" })], decision({ id: "b" }));
    expect(parseDecisions(stored).map((d) => d.id)).toEqual(["a", "b"]);
    expect(stored.endsWith("\n")).toBe(true);
  });
  it("keeps only the most recent records, so the file cannot grow without bound", () => {
    let existing: ReviewDecision[] = [];
    for (let i = 0; i < MAX_RECORDS + 25; i++) existing = parseDecisions(appendDecision(existing, decision({ id: `d${i}` })));
    expect(existing).toHaveLength(MAX_RECORDS);
    expect(existing.at(-1)?.id).toBe(`d${MAX_RECORDS + 24}`);
    expect(existing[0]?.id).toBe("d25");
  });
});

describe("cleanNote", () => {
  it("makes a note one safe line", () => {
    expect(cleanNote("  fine\n\tby me \r\n ")).toBe("fine by me");
    expect(cleanNote(`a${ESC}[31mb\u0007c`)).toBe("a [31mb c");
    expect(cleanNote("a‮b")).toBe("a b");
    expect(cleanNote("x".repeat(2000))).toHaveLength(MAX_NOTE_CHARS);
    expect(cleanNote("")).toBe("");
  });
  it("keeps real text in every script", () => {
    expect(cleanNote("日本語 é 👨‍👩‍👧 — ok")).toBe("日本語 é 👨‍👩‍👧 — ok");
  });
});

describe("decisionState: a decision applies only to the exact changes it was about", () => {
  it("is none when nothing was decided", () => {
    expect(decisionState([], FP, 3)).toEqual({ kind: "none" });
  });
  it("is current only when the fingerprint is unchanged and there are changes", () => {
    expect(decisionState([decision()], FP, 2).kind).toBe("current");
    expect(decisionState([decision()], FP2, 2).kind).toBe("stale");
  });
  it("is stale when there are no changes at all, even if the fingerprint matches", () => {
    expect(decisionState([decision()], FP, 0).kind).toBe("stale");
  });
  it("uses the latest decision", () => {
    const s = decisionState([decision({ id: "old", fingerprint: FP2, decision: "rejected" }), decision({ id: "new" })], FP, 1);
    expect(s).toMatchObject({ kind: "current", decision: { id: "new", decision: "approved" } });
  });
});

let base = "";
let project = "";
let out: string[] = [];
let err: string[] = [];
let clock = 0;
let head: Record<string, string> = {};
let porcelain = "";
let isRepo = true;

const git = async (args: readonly string[]): Promise<{ exitCode: number; stdout: string }> => {
  if (!isRepo) return { exitCode: 128, stdout: "" };
  if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { exitCode: 0, stdout: "true\n" };
  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { exitCode: 0, stdout: `${project}\n` };
  if (args[0] === "symbolic-ref") return { exitCode: 0, stdout: "main\n" };
  if (args[0] === "status") return { exitCode: 0, stdout: porcelain };
  if (args[0] === "show") {
    const text = head[String(args[1]).replace(/^HEAD:/, "")];
    return text === undefined ? { exitCode: 128, stdout: "" } : { exitCode: 0, stdout: text };
  }
  return { exitCode: 128, stdout: "" };
};

function makeCtx(over: Partial<CliContext> = {}): CliContext {
  return createContext({
    cwd: project,
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), LANG: "en_US.UTF-8", PATH: "" }, homedir: base },
    git,
    newId: () => `id${++clock}`,
    now: () => new Date(Date.UTC(2026, 2, 4, 12, 0, 0) + clock * 60_000),
    terminal: () => ({ isTTY: false, columns: undefined, rows: undefined }),
    ...over,
  });
}
const run = (argv: string[]): Promise<number> => runCli(argv, makeCtx());
const stdout = (): string => out.join("\n");
const stderr = (): string => err.join("\n");
/** The output with line breaks and runs of spaces collapsed, so a sentence that wrapped can still be matched. */
const flat = (): string => stdout().replace(/\s+/g, " ");
const write = async (rel: string, text: string): Promise<void> => {
  await mkdir(path.dirname(path.join(project, rel)), { recursive: true });
  await writeFile(path.join(project, rel), text);
};

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-review-"));
  project = path.join(base, "proj");
  await mkdir(project);
  out = [];
  err = [];
  clock = 0;
  head = {};
  porcelain = " M src/a.js\0?? src/b.js\0";
  isRepo = true;
  await write("src/a.js", "const a = 2;\n");
  await write("src/b.js", "export const b = 1;\n");
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("the review fingerprint", () => {
  const fp = (): Promise<{ fingerprint: string; fileCount: number }> => reviewFingerprint(makeCtx());
  it("is the same for the same changes, and counts the files", async () => {
    const a = await fp();
    expect(a.fileCount).toBe(2);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await fp()).toEqual(a);
  });
  it("changes when a changed file's content changes, even by one character", async () => {
    const before = (await fp()).fingerprint;
    await write("src/a.js", "const a = 3;\n");
    expect((await fp()).fingerprint).not.toBe(before);
    await write("src/a.js", "const a = 2;\n");
    expect((await fp()).fingerprint).toBe(before);
  });
  it("changes when the set of changed files changes, or a file's status does", async () => {
    const before = (await fp()).fingerprint;
    porcelain = " M src/a.js\0";
    expect((await fp()).fingerprint).not.toBe(before);
    porcelain = "?? src/a.js\0?? src/b.js\0";
    expect((await fp()).fingerprint).not.toBe(before);
  });
  it("does not depend on the order git lists the files in", async () => {
    const before = (await fp()).fingerprint;
    porcelain = "?? src/b.js\0 M src/a.js\0";
    expect((await fp()).fingerprint).toBe(before);
  });
  it("copes with a deleted file and an unreadable one, deterministically", async () => {
    porcelain = " D src/gone.js\0?? missing.bin\0";
    const a = await fp();
    expect(a.fileCount).toBe(2);
    expect(await fp()).toEqual(a);
  });
  it("reports an empty set of changes as zero files", async () => {
    porcelain = "";
    expect((await fp()).fileCount).toBe(0);
  });
  it("explains when this is not a git repository", async () => {
    isRepo = false;
    await expect(fp()).rejects.toThrow(/not a git repository/);
  });
});

describe("jpe review", () => {
  it("is registered and listed in help", async () => {
    expect(COMMAND_NAMES).toContain("review");
    await run(["help"]);
    expect(stdout()).toMatch(/review approve\|reject/);
  });

  it("approves the current changes and says exactly what that does and does not mean", async () => {
    expect(await run(["review", "approve", "--note", "checked by hand"])).toBe(0);
    expect(stdout()).toContain("Recorded: approved (2 files)");
    expect(flat()).toContain("nothing was committed, staged or changed");
    expect(flat()).toContain("shown as stale");
    out = [];
    await run(["review", "status"]);
    expect(stdout()).toContain("Approved");
    expect(stdout()).toContain("unchanged since");
    expect(stdout()).toContain("Note: checked by hand");
  });

  it("shows the decision as stale as soon as a file changes, and again as current once it is decided again", async () => {
    await run(["review", "approve"]);
    await write("src/a.js", "const a = 999; // changed after the review\n");
    out = [];
    await run(["review", "status"]);
    expect(stdout()).toContain("Stale");
    expect(flat()).toContain("no longer the current ones");
    expect(flat()).toContain("decide again");
    expect(stdout()).not.toContain("unchanged since");
    out = [];
    await run(["review", "reject", "--note", "second look"]);
    out = [];
    await run(["review", "status"]);
    expect(stdout()).toContain("Rejected");
    expect(stdout()).toContain("second look");
  });

  it("is stale, not current, once there are no changes left to be about", async () => {
    await run(["review", "approve"]);
    porcelain = "";
    out = [];
    await run(["review", "status", "--json"]);
    expect(JSON.parse(stdout())).toMatchObject({ state: "stale", fileCount: 0 });
  });

  it("says no decision has been recorded when none has", async () => {
    await run(["review", "status"]);
    expect(stdout()).toContain("No decision recorded for 2 uncommitted files");
  });

  it("refuses to approve or reject when there is nothing to review", async () => {
    porcelain = "";
    expect(await run(["review", "approve"])).toBe(1);
    expect(stderr()).toContain("There are no uncommitted changes to review, so there is nothing to approve or reject.");
    expect(await readdir(base)).toEqual(["proj"]);
  });

  it("explains when this is not a git repository", async () => {
    isRepo = false;
    expect(await run(["review", "approve"])).toBe(1);
    expect(stderr()).toContain("not a git repository");
  });

  it("--json gives the record and the state", async () => {
    await run(["review", "approve", "--json"]);
    const record = JSON.parse(stdout());
    expect(record).toMatchObject({ decision: "approved", fileCount: 2 });
    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    out = [];
    await run(["review", "status", "--json"]);
    expect(JSON.parse(stdout())).toMatchObject({ state: "current", fileCount: 2, decision: { decision: "approved" } });
  });

  it("lists past decisions, newest first, and says when there are none", async () => {
    await run(["review", "history"]);
    expect(stdout()).toContain("No review decisions have been recorded for this project.");
    await run(["review", "approve", "--note", "alpha note"]);
    await run(["review", "reject", "--note", "beta note"]);
    out = [];
    await run(["review", "history", "--width", "100"]);
    expect(stdout().indexOf("beta note")).toBeLessThan(stdout().indexOf("alpha note"));
    expect(stdout()).toMatch(/rejected\s+│\s+2 │ beta note/);
    expect(flat()).toContain("does not say whether later changes are fine");
    out = [];
    await run(["review", "history", "--json"]);
    expect(JSON.parse(stdout()).map((d: ReviewDecision) => d.decision)).toEqual(["rejected", "approved"]);
  });

  it("only records: it never touches the project", async () => {
    const before = (await readdir(project, { recursive: true })).sort();
    await run(["review", "approve"]);
    await run(["review", "reject"]);
    await run(["review", "status"]);
    expect((await readdir(project, { recursive: true })).sort()).toEqual(before);
  });

  it("stores only a safe single-line note, and never lets one drive the terminal", async () => {
    await run(["review", "approve", "--note", `ok${ESC}[2J${ESC}]0;pwned\u0007\nsecond line`]);
    out = [];
    await run(["review", "status"]);
    expect(stdout()).not.toContain(ESC);
    expect(stdout()).toContain("Note: ok");
    const stored = await readFile(path.join(base, "data", "projects", (await readdir(path.join(base, "data", "projects")))[0] ?? "", "reviews.jsonl"), "utf8");
    expect(stored).not.toContain(ESC);
    expect(stored.trim().split("\n")).toHaveLength(1);
  });

  it("treats a damaged decisions file as empty, and repairs it on the next decision", async () => {
    const ctx = makeCtx();
    await ctx.writeText(path.join(ctx.stateDir(), "reviews.jsonl"), "garbage\n{broken\n");
    await run(["review", "status"]);
    expect(stdout()).toContain("No decision recorded");
    await run(["review", "approve"]);
    const stored = await readFile(path.join(ctx.stateDir(), "reviews.jsonl"), "utf8");
    expect(stored.trim().split("\n")).toHaveLength(1);
    expect(stored).not.toContain("garbage");
  });

  it("explains its usage", async () => {
    expect(await run(["review"])).toBe(1);
    expect(stderr()).toContain("Usage: jpe review");
    err = [];
    expect(await run(["review", "bogus"])).toBe(1);
  });
});

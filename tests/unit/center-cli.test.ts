import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { COMMAND_NAMES, runCli } from "../../src/cli/main.js";
import { EvidenceLedger } from "../../src/core/ledger.js";
import { displayWidth, stripAnsi } from "../../src/ui/text.js";

const ESC = "\u001b";
let base = "";
let project = "";
let out: string[] = [];
let err: string[] = [];

function makeCtx(over: Partial<CliContext> = {}): CliContext {
  return createContext({
    cwd: project,
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), LANG: "en_US.UTF-8", PATH: "", CANARY_VALUE: "canary-value-5521" }, homedir: base },
    git: async () => ({ exitCode: 128, stdout: "" }),
    terminal: () => ({ isTTY: false, columns: undefined, rows: undefined }),
    now: () => new Date("2026-03-04T12:00:00.000Z"),
    ...over,
  });
}
const run = (argv: string[], over?: Partial<CliContext>): Promise<number> => runCli(argv, makeCtx(over));
const stdout = (): string => out.join("\n");

const recordFailure = async (): Promise<void> => {
  const ctx = makeCtx();
  const ledger = new EvidenceLedger({ now: () => new Date("2026-03-04T11:55:00.000Z"), newId: () => "e1" });
  ledger.recordCommand({ check: "unit-test", command: "npm test", exitCode: 1, durationMs: 5, output: "1 failed" });
  await ctx.writeText(path.join(ctx.stateDir(), "ledger.jsonl"), ledger.toJsonLines());
  await ctx.writeText(path.join(ctx.stateDir(), "run.json"), JSON.stringify({ at: "2026-03-04T11:55:00.000Z", required: ["unit-test"] }));
};

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-center-"));
  project = path.join(base, "demo-project");
  await mkdir(project);
  await writeFile(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "vitest run", build: "tsup" } }));
  out = [];
  err = [];
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("jpe center", () => {
  it("is registered and listed in help", async () => {
    expect(COMMAND_NAMES).toContain("center");
    await run(["help"]);
    expect(stdout()).toMatch(/center \[home\|palette <query>\|hud\]/);
  });

  it("shows the home screen from real project facts, with no escape sequences when piped", async () => {
    expect(await run(["center"])).toBe(0);
    expect(stdout()).toContain("JPE command center");
    expect(stdout()).toMatch(/Project\s+demo-project · node/);
    expect(stdout()).toContain("NOT_TESTED");
    expect(stdout()).toContain("1. /jpe:verify");
    expect(stdout()).not.toContain(ESC);
  });

  it("puts a recorded failure first, with the evidence behind it", async () => {
    await recordFailure();
    expect(await run(["center"])).toBe(0);
    expect(stdout()).toContain("FAILED");
    expect(stdout()).toContain("last run 5 minutes ago");
    expect(stdout()).toContain("1. /jpe:fix");
    expect(stdout()).toContain("unit-test failed with exit code 1.");
    expect(stdout()).toContain("(confirmed)");
  });

  it("is read-only: running it creates nothing in the project", async () => {
    await run(["center"]);
    await run(["center", "hud", "--json"]);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(project)).sort()).toEqual(["package.json"]);
  });

  it("center hud --json is the data the interface reads: versioned, complete, and free of environment values", async () => {
    await recordFailure();
    expect(await run(["center", "hud", "--json"])).toBe(0);
    expect(stdout()).not.toContain("canary-value-5521");
    const hud = JSON.parse(stdout());
    expect(hud).toMatchObject({
      hudVersion: 1,
      project: { name: "demo-project", ecosystems: ["node"] },
      git: { state: "not-repo" },
      verification: { status: "FAILED", at: "2026-03-04T11:55:00.000Z" },
      runtime: { offline: false, approval: "risk-based" },
    });
    expect(hud.verification.checksAvailable).toEqual(expect.arrayContaining(["unit-test", "build"]));
    expect(Object.keys(hud).sort()).toEqual(["generatedAt", "git", "hudVersion", "languageServersMissing", "project", "runtime", "verification"]);
  });

  it("center --json adds the suggestions and the numbered actions", async () => {
    await recordFailure();
    expect(await run(["center", "--json"])).toBe(0);
    const json = JSON.parse(stdout());
    expect(Object.keys(json).sort()).toEqual(["actions", "hud", "suggestions"]);
    expect(json.suggestions[0]).toMatchObject({ id: "verification-failed", commandId: "fix", basis: "confirmed" });
    expect(json.actions[0]).toMatchObject({ n: 1, commandId: "fix", slash: "/jpe:fix", changesThings: true });
  });

  it("center hud prints the facts as text", async () => {
    expect(await run(["center", "hud"])).toBe(0);
    expect(stdout()).toContain("Project facts");
    expect(stdout()).toContain("Verification");
  });

  it("center palette searches the commands, numbered the way Enter resolves them", async () => {
    expect(await run(["center", "palette", "ver"])).toBe(0);
    expect(stdout()).toContain("Command palette: ver");
    expect(stdout()).toMatch(/1 │ \/jpe:verify/);
    out = [];
    expect(await run(["center", "palette", "ver", "--json"])).toBe(0);
    expect(JSON.parse(stdout())[0]).toMatchObject({ id: "verify", slash: "/jpe:verify", changesThings: false });
  });

  it("center palette says plainly when nothing matches", async () => {
    expect(await run(["center", "palette", "qqqzzz"])).toBe(0);
    expect(stdout()).toContain('No command matches "qqqzzz".');
  });

  it("rejects an unknown view", async () => {
    expect(await run(["center", "bogus"])).toBe(1);
    expect(err.join("\n")).toMatch(/Unknown view "bogus"/);
  });

  it("draws within the width, with the same display flags as jpe ui", async () => {
    await recordFailure();
    for (const width of [20, 30, 50, 80]) {
      out = [];
      expect(await run(["center", "--width", String(width)], { terminal: () => ({ isTTY: true, columns: 200, rows: 50 }) })).toBe(0);
      for (const line of stdout().split("\n")) expect(displayWidth(stripAnsi(line)), `@${width}: ${stripAnsi(line)}`).toBeLessThanOrEqual(width);
    }
    out = [];
    expect(await run(["center", "--screen-reader"])).toBe(0);
    expect(stdout()).not.toMatch(/[│─╭✘▲]/);
    out = [];
    expect(await run(["center", "--theme", "neon"])).toBe(1);
  });

  it("paints headings in the accent colour on a colour terminal", async () => {
    expect(await run(["center"], { terminal: () => ({ isTTY: true, columns: 100, rows: 40 }), pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), LANG: "en_US.UTF-8", COLORTERM: "truecolor", PATH: "" }, homedir: base } })).toBe(0);
    expect(stdout()).toContain(`${ESC}[1;38;2;155;109;255mJPE command center`);
  });
});

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.js";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";
import type { RunOptions, RunResult } from "../../src/security/run.js";

let base = "";
let project = "";
let outLines: string[] = [];
let errLines: string[] = [];
let n = 0;

const ok = (stdout = ""): RunResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false, truncated: false, durationMs: 1 });
const fail = (stderr: string): RunResult => ({ exitCode: 1, stdout: "", stderr, timedOut: false, truncated: false, durationMs: 1 });

function makeCtx(over: Partial<CliContext> = {}): CliContext {
  return createContext({
    cwd: project,
    out: (t) => void outLines.push(t),
    err: (t) => void errLines.push(t),
    readStdin: async () => "TypeError: Cannot read properties of undefined (reading 'x')",
    pathEnv: { platform: process.platform, env: { CLAUDE_PLUGIN_DATA: path.join(base, "data") }, homedir: base },
    git: async () => ({ exitCode: 128, stdout: "" }),
    now: () => new Date("2026-02-03T04:05:06Z"),
    newId: () => `id${++n}`,
    ...over,
  });
}
const out = (): string => outLines.join("\n");
const err = (): string => errLines.join("\n");

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-cli-"));
  project = path.join(base, "project");
  await mkdir(project);
  outLines = [];
  errLines = [];
  n = 0;
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const writeProject = async (files: Record<string, string>): Promise<void> => {
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, rel)), { recursive: true });
    await writeFile(path.join(project, rel), text);
  }
};

describe("parseArgs", () => {
  it("handles flags, values, equals-form, booleans and --", () => {
    const a = parseArgs(["file", "x.ts", "--phase", "after", "--limit=5", "--json", "--", "--literal"]);
    expect(a.positionals).toEqual(["file", "x.ts", "--literal"]);
    expect(a.flags.get("phase")).toBe("after");
    expect(a.flags.get("limit")).toBe("5");
    expect(a.flags.get("json")).toBe(true);
  });
});

describe("dispatch", () => {
  it("prints help, rejects unknown commands with a distinct exit code, and never leaks stack traces", async () => {
    expect(await runCli([], makeCtx())).toBe(0);
    expect(out()).toContain("Usage: jpe <command>");
    outLines = [];
    expect(await runCli(["nonsense"], makeCtx())).toBe(64);
    expect(err()).toContain('unknown command "nonsense"');
    errLines = [];
    expect(await runCli(["brief", "file"], makeCtx())).toBe(1);
    expect(err()).toMatch(/^jpe: /);
    expect(err()).not.toContain("at ");
  });
  it("refuses paths outside the project", async () => {
    expect(await runCli(["brief", "file", "../escape.ts"], makeCtx())).toBe(1);
    expect(err()).toContain("outside the project");
  });
});

describe("brief", () => {
  it("builds a file briefing with facts, dependents and the configured rules", async () => {
    await writeProject({ "src/util.ts": "export function add(a: number, b: number) {\n  return a + b;\n}\n", "src/use.ts": "import { add } from './util';\nadd(1, 2);\n" });
    expect(await runCli(["brief", "file", "src/util.ts", "--dependents", "--phase", "before"], makeCtx({ git: async () => ({ exitCode: 128, stdout: "" }) }))).toBe(0);
    expect(out()).toContain("before coding");
    expect(out()).toContain("function add");
    expect(out()).toContain("Files that import this one: src/use.ts");
  });
  it("explains an error from stdin and from arguments", async () => {
    expect(await runCli(["brief", "error", "--stdin"], makeCtx())).toBe(0);
    expect(out()).toContain("optional chaining");
    outLines = [];
    expect(await runCli(["brief", "error", "EADDRINUSE", "port", "3000"], makeCtx())).toBe(0);
    expect(out()).toContain("port the server wants is already taken");
  });
  it("briefs a change against the committed version, or treats a new file as all added", async () => {
    await writeProject({ "a.js": "const a = 1;\neval(x);\n" });
    const committed = makeCtx({ git: async (args) => (args[0] === "show" ? { exitCode: 0, stdout: "const a = 1;\n" } : { exitCode: 128, stdout: "" }) });
    expect(await runCli(["brief", "change", "a.js"], committed)).toBe(0);
    expect(out()).toContain("+1 / -0");
    expect(out()).toContain("New possible risks");
    outLines = [];
    expect(await runCli(["brief", "change", "a.js"], makeCtx())).toBe(0);
    expect(out()).toContain("no committed version");
  });
});

describe("checks, verify and status", () => {
  const pkg = JSON.stringify({ scripts: { test: "vitest run", build: "tsup" } });

  it("reports a project with no checks honestly", async () => {
    await runCli(["checks"], makeCtx());
    expect(out()).toContain("No verification commands were found");
    outLines = [];
    expect(await runCli(["verify"], makeCtx())).toBe(4);
    expect(out()).toContain("STATUS: NOT_TESTED");
  });

  it("runs discovered checks, derives status from evidence, shows failure output, and persists the run", async () => {
    await writeProject({ "package.json": pkg });
    const run = async (o: RunOptions): Promise<RunResult> => (o.args.includes("test") ? fail("1 failed: add() expected 3 but got 4 token=abcdef123456789") : ok("built"));
    expect(await runCli(["verify"], makeCtx({ run }))).toBe(1);
    expect(out()).toContain("STATUS: FAILED");
    expect(out()).toContain("unit-test failed with exit code 1");
    expect(out()).toContain("expected 3 but got 4");
    expect(out()).not.toContain("abcdef123456789");
    expect(out()).toContain("no baseline was captured");

    outLines = [];
    expect(await runCli(["status"], makeCtx())).toBe(1);
    expect(out()).toContain("STATUS: FAILED");
    expect(out()).toContain("Last run: 2026-02-03T04:05:06.000Z");
  });

  it("uses a baseline to separate pre-existing failures from new ones", async () => {
    await writeProject({ "package.json": pkg });
    const run = async (o: RunOptions): Promise<RunResult> => (o.args.includes("test") ? fail("old failure") : ok());
    expect(await runCli(["verify", "--baseline"], makeCtx({ run }))).toBe(0);
    expect(out()).toContain("FAILING: npm run test");
    outLines = [];
    expect(await runCli(["verify"], makeCtx({ run }))).toBe(0);
    expect(out()).toContain("STATUS: FUNCTIONAL_WITH_WARNINGS");
    expect(out()).toContain("failure existed before this change");
  });

  it("reports VERIFIED only when everything required passed, and validates --only", async () => {
    await writeProject({ "package.json": pkg });
    expect(await runCli(["verify"], makeCtx({ run: async () => ok() }))).toBe(0);
    expect(out()).toContain("STATUS: VERIFIED");
    expect(await runCli(["verify", "--only", "bogus"], makeCtx({ run: async () => ok() }))).toBe(1);
    expect(err()).toContain("Unknown check name");
  });

  it("status with no run says NOT_TESTED", async () => {
    expect(await runCli(["status"], makeCtx())).toBe(4);
    expect(out()).toContain("No verification has been run");
  });
});

describe("config", () => {
  it("shows defaults, validates changes, keeps a backup of the replaced file, and never writes invalid values", async () => {
    expect(await runCli(["config", "show"], makeCtx())).toBe(0);
    expect(JSON.parse(out()).engineering.maxRepairAttempts).toBe(3);

    expect(await runCli(["config", "set", "engineering.maxRepairAttempts", "99"], makeCtx())).toBe(1);
    expect(err()).toContain("not allowed");
    expect(await runCli(["config", "set", "bogus.setting", "1"], makeCtx())).toBe(1);
    expect(await runCli(["config", "set", "__proto__.x", "1"], makeCtx())).toBe(1);

    outLines = [];
    expect(await runCli(["config", "set", "explanation.depth", "deep"], makeCtx())).toBe(0);
    expect(await runCli(["config", "set", "explanation.examples", "always"], makeCtx())).toBe(0);
    const dataDir = path.join(base, "data");
    const files = await readdir(dataDir);
    expect(files).toContain("config.json");
    expect(files.some((f) => f.startsWith("config.json.bak-"))).toBe(true);
    const saved = JSON.parse(await readFile(path.join(dataDir, "config.json"), "utf8"));
    expect(saved).toMatchObject({ explanation: { depth: "deep", examples: "always" }, schemaVersion: 1 });

    outLines = [];
    await runCli(["config", "show"], makeCtx());
    expect(JSON.parse(out()).explanation.depth).toBe("deep");
  });

  it("project scope overrides global, and export/import round-trips without secrets", async () => {
    await runCli(["config", "set", "engineering.maxRepairAttempts", "7"], makeCtx());
    await runCli(["config", "set", "engineering.maxRepairAttempts", "2", "--project"], makeCtx());
    outLines = [];
    await runCli(["config", "show"], makeCtx());
    expect(JSON.parse(out()).engineering.maxRepairAttempts).toBe(2);

    expect(await runCli(["config", "export", "--out", "exported.json"], makeCtx())).toBe(0);
    const exported = await readFile(path.join(project, "exported.json"), "utf8");
    expect(JSON.parse(exported).engineering.maxRepairAttempts).toBe(2);
    await writeFile(path.join(project, "bad.json"), JSON.stringify({ apiKey: "sk-should-not-import-123456" }));
    expect(await runCli(["config", "import", "bad.json"], makeCtx())).toBe(1);
    expect(await runCli(["config", "import", "exported.json", "--project"], makeCtx())).toBe(0);
  });
});

describe("backup", () => {
  it("creates, seals and rolls back, and refuses credentials files", async () => {
    await writeProject({ "a.txt": "original", ".env": "TOKEN=abc" });
    expect(await runCli(["backup", "create", "a.txt", "new.txt", "--label", "test"], makeCtx())).toBe(0);
    const id = /Backup (\S+) created/.exec(out())?.[1] as string;
    expect(id).toMatch(/^bk-/);
    await writeFile(path.join(project, "a.txt"), "changed");
    await writeFile(path.join(project, "new.txt"), "made");
    expect(await runCli(["backup", "seal", id], makeCtx())).toBe(0);
    expect(await runCli(["backup", "verify", id], makeCtx())).toBe(0);
    outLines = [];
    expect(await runCli(["backup", "rollback", id], makeCtx())).toBe(0);
    expect(out()).toContain("restored a.txt");
    expect(await readFile(path.join(project, "a.txt"), "utf8")).toBe("original");
    expect(await runCli(["backup", "list"], makeCtx())).toBe(0);
    expect(await runCli(["backup", "create", ".env"], makeCtx())).toBe(1);
    expect(err()).toContain("credentials file");
  });
});

describe("scan and audit", () => {
  it("finds credentials without printing them and skips credential files' contents", async () => {
    await writeProject({ "src/a.ts": "const k = 'sk-abcdefghijklmnop1234';\n", ".env": "SECRET=shouldnotbereadxyz" });
    const ctx = makeCtx({ git: async () => ({ exitCode: 0, stdout: "src/a.ts\0.env\0" }) });
    expect(await runCli(["scan"], ctx)).toBe(1);
    expect(out()).toContain("src/a.ts:1 anthropic-or-openai-key");
    expect(out()).toContain(".env");
    expect(out()).not.toContain("abcdefghijklmnop1234");
    expect(out()).not.toContain("shouldnotbereadxyz");
  });
  it("audit lists only high and medium leads and labels them as leads", async () => {
    await writeProject({ "src/a.js": "eval(x);\n// TODO later\n" });
    const ctx = makeCtx({ git: async () => ({ exitCode: 0, stdout: "src/a.js\0" }) });
    expect(await runCli(["audit"], ctx)).toBe(0);
    expect(out()).toContain("[high] src/a.js:1");
    expect(out()).not.toContain("TODO");
    expect(out()).toContain("not a confirmed bug");
  });
});

describe("install-plan and research (offline)", () => {
  it("shows install options without running anything, and rejects unknown languages", async () => {
    const run = async (): Promise<RunResult> => {
      throw new Error("install-plan must not run commands");
    };
    expect(await runCli(["install-plan", "go"], makeCtx({ run }))).toBe(0);
    expect(out()).toContain("go install golang.org/x/tools/gopls@latest");
    expect(out()).toContain("Nothing has been run");
    expect(await runCli(["install-plan", "cobol"], makeCtx({ run }))).toBe(1);
  });

  it("researches an installed package offline using only local files", async () => {
    await writeProject({
      "package.json": JSON.stringify({ dependencies: { zod: "^4.0.0" } }),
      "node_modules/zod/package.json": JSON.stringify({ name: "zod", version: "4.1.2", types: "index.d.ts" }),
      "node_modules/zod/index.d.ts": "export declare function strictObject<T>(shape: T): ZodObject<T>;\n",
    });
    let networkCalls = 0;
    const net = { resolve: async () => ["93.184.216.34"], fetch: (async () => (networkCalls++, new Response("x"))) as typeof fetch };
    expect(await runCli(["research", "zod", "--topic", "strictObject", "--offline"], makeCtx({ net }))).toBe(0);
    expect(networkCalls).toBe(0);
    expect(out()).toContain("MODE: offline");
    expect(out()).toContain("strictObject<T>(shape: T)");
    expect(out()).toContain("version match: exact");
    expect(out()).toContain("Context7: not queried by this command");
  });
});

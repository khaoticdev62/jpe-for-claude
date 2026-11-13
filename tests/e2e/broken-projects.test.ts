/**
 * End-to-end: JPE against deliberately broken projects, with REAL tools (TypeScript compiler, node's test
 * runner, git, and the TypeScript language server when it is installed). Nothing here is mocked: each test
 * proves JPE detects the fault, explains it, repairs it safely with a backup, and reports honest evidence.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";
import { EvidenceLedger } from "../../src/core/ledger.js";
import { deriveStatus } from "../../src/core/status.js";
import { sha256Hex } from "../../src/docs/cache.js";
import { onPostToolUse } from "../../src/hooks/handlers.js";
import { parsePayload } from "../../src/hooks/payload.js";
import { findOnPath } from "../../src/lsp/detect.js";
import { discoverChecks } from "../../src/project/checks.js";
import { detectProject } from "../../src/project/detect.js";
import { nodeProjectFs } from "../../src/project/fs.js";
import { BackupStore } from "../../src/recovery/backup.js";
import { runCommand } from "../../src/security/run.js";
import { repairLoop } from "../../src/verification/repair.js";
import { captureBaseline } from "../../src/verification/runner.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = path.join(ROOT, "tests", "fixtures", "broken");
const TSC = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
const TIMEOUT = 180_000;
const realTsServer = await findOnPath("typescript-language-server", { platform: process.platform, env: process.env, exists: async (f) => existsSync(f) });

let base = "";
let project = "";
let out: string[] = [];

function ctx(): CliContext {
  return createContext({
    cwd: project,
    out: (t) => void out.push(t),
    err: (t) => void out.push(t),
    pathEnv: { platform: process.platform, env: { ...process.env, CLAUDE_PLUGIN_DATA: path.join(base, "data") }, homedir: base },
  });
}
const jpe = async (...argv: string[]): Promise<{ code: number; text: string }> => {
  out = [];
  const code = await runCli(argv, ctx());
  return { code, text: out.join("\n") };
};
const git = (...args: string[]): void => void execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.test", ...args], { cwd: project, stdio: "ignore" });

async function setUp(fixture: string, scripts: Record<string, string>, deps: Record<string, string> = {}): Promise<void> {
  await cp(path.join(FIXTURES, fixture), project, { recursive: true });
  await writeFile(path.join(project, "package.json"), JSON.stringify({ name: fixture, private: true, type: "module", scripts, dependencies: deps }, null, 2));
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "broken sample");
}
const typecheck = { typecheck: `node "${TSC}" -p .` };
const read = (rel: string): Promise<string> => readFile(path.join(project, rel), "utf8");
const edit = async (rel: string, from: string, to: string): Promise<void> => {
  const text = await read(rel);
  expect(text, `${rel} should contain the text being replaced`).toContain(from);
  await writeFile(path.join(project, rel), text.replace(from, to));
};

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-e2e-"));
  project = path.join(base, "project");
  await mkdir(project);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

describe("type error", () => {
  it("detects with the real compiler, explains it, repairs it with a backup, and rollback restores it", async () => {
    await setUp("type-error", typecheck);

    const broken = await jpe("verify");
    expect(broken.code).toBe(1);
    expect(broken.text).toContain("STATUS: FAILED");
    expect(broken.text).toMatch(/TS2322/);

    const errorLine = broken.text.split("\n").find((l) => l.includes("TS2322")) ?? "";
    const explained = await jpe("brief", "error", errorLine);
    expect(explained.text).toContain("A value has the wrong type for where it is being put");

    const created = await jpe("backup", "create", "src/math.ts", "--label", "fix type error");
    const id = /Backup (\S+) created/.exec(created.text)?.[1] as string;
    await edit("src/math.ts", 'let sum: number = "0";', "let sum = 0;");
    await jpe("backup", "seal", id);

    const fixed = await jpe("verify");
    expect(fixed.code).toBe(0);
    expect(fixed.text).toContain("STATUS: VERIFIED");
    expect((await jpe("status")).text).toContain("STATUS: VERIFIED");

    const change = await jpe("brief", "change", "src/math.ts");
    expect(change.text).toContain("+1 / -1");

    const rolled = await jpe("backup", "rollback", id);
    expect(rolled.text).toContain("restored src/math.ts");
    expect(await read("src/math.ts")).toContain('"0"');
    expect((await jpe("verify")).text).toContain("STATUS: FAILED");
  }, TIMEOUT);

  it.skipIf(!realTsServer)("the real TypeScript language server reports the same error, and the edit hook surfaces it", async () => {
    await setUp("type-error", typecheck);
    const lsp = await jpe("lsp", "diagnostics", "src/math.ts");
    expect(lsp.text).toContain("Source: language server");
    expect(lsp.text).toMatch(/src\/math\.ts:3:\d+ error 2322/);

    const hookCtx = ctx();
    const payload = { session_id: "e2e-session", cwd: project, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: path.join(project, "src", "math.ts") } };
    const hook = await onPostToolUse(parsePayload("PostToolUse", JSON.stringify(payload)), hookCtx);
    expect(hook?.hookSpecificOutput?.additionalContext).toMatch(/error\(s\) in src\/math\.ts/);
  }, TIMEOUT);
});

describe("missing import", () => {
  it("detects the missing module, explains it, and verifies once the module exists", async () => {
    await setUp("missing-import", typecheck);
    const broken = await jpe("verify");
    expect(broken.text).toContain("STATUS: FAILED");
    expect(broken.text).toMatch(/TS2307/);
    const errorLine = broken.text.split("\n").find((l) => l.includes("TS2307")) ?? "";
    expect((await jpe("brief", "error", errorLine)).text).toContain("An imported file or package cannot be found");

    await writeFile(path.join(project, "src", "formatter.ts"), "export function format(name: string): string {\n  return `Hello, ${name}`;\n}\n");
    expect((await jpe("verify")).text).toContain("STATUS: VERIFIED");
  }, TIMEOUT);
});

describe("incorrect API usage", () => {
  it("the compiler rejects the call, and research of the INSTALLED version shows the real API", async () => {
    await setUp("wrong-api", typecheck, { zod: "^4.0.0" });
    await mkdir(path.join(project, "node_modules"));
    await symlink(path.join(ROOT, "node_modules", "zod"), path.join(project, "node_modules", "zod"), process.platform === "win32" ? "junction" : "dir");

    const broken = await jpe("verify");
    expect(broken.text).toContain("STATUS: FAILED");
    expect(broken.text).toMatch(/TS2551|TS2339/);
    const apiError = broken.text.split("\n").find((l) => /TS2551|TS2339/.test(l)) ?? "";
    expect((await jpe("brief", "error", apiError)).text).toContain("asks an object for something it does not have");
    expect(broken.text).toContain("minimumLength");

    const missing = await jpe("research", "zod", "--topic", "minimumLength", "--offline");
    expect(missing.text).toContain('"minimumLength" does not appear');
    const real = await jpe("research", "zod", "--topic", "min", "--offline");
    const installed = JSON.parse(await readFile(path.join(ROOT, "node_modules", "zod", "package.json"), "utf8")).version as string;
    expect(real.text).toContain(`Installed: zod@${installed}`);
    expect(real.text).toContain("version match: exact");
    expect(real.text).toMatch(/min\(minLength: number/);
    expect(real.text).toContain("MODE: offline");

    await edit("src/schema.ts", ".minimumLength(3)", ".min(3)");
    expect((await jpe("verify")).text).toContain("STATUS: VERIFIED");
  }, TIMEOUT);
});

describe("runtime failure", () => {
  it("the bounded repair loop fixes the code, never touches the test, and ends VERIFIED", async () => {
    await setUp("runtime-failure", { test: "node --test" });
    const testBefore = sha256Hex(await read("test/add.test.mjs"));
    const info = await detectProject(project, nodeProjectFs);
    const checks = await discoverChecks(info, nodeProjectFs);
    expect(checks.map((c) => c.check)).toEqual(["unit-test"]);

    const ledger = new EvidenceLedger({ now: () => new Date(), newId: (() => { let n = 0; return () => `e${++n}`; })() });
    const backups = new BackupStore({ dir: path.join(base, "backups"), now: () => new Date(), newId: (() => { let n = 0; return () => `bk${++n}`; })() });
    const repairs: string[] = [];
    const result = await repairLoop({
      checks,
      deps: { run: runCommand, ledger, cwd: project, timeoutMs: 60_000 },
      maxAttempts: 3,
      deadlineMs: 120_000,
      now: () => Date.now(),
      // Stand-in for Claude: one targeted edit to the source, after a backup.
      repair: async ({ failures }) => {
        expect(failures[0]?.output).toContain("add() returns the sum");
        const b = await backups.create(project, ["src/add.mjs"], "repair");
        await edit("src/add.mjs", "return a - b;", "return a + b;");
        await backups.seal(b.id);
        repairs.push(b.id);
        return { changed: true, summary: "add() subtracted instead of adding" };
      },
    });
    expect(result).toMatchObject({ outcome: "fixed", attempts: 1 });
    expect(deriveStatus(ledger.entries, ["unit-test"]).status).toBe("VERIFIED");
    expect(sha256Hex(await read("test/add.test.mjs"))).toBe(testBefore);
    expect(repairs).toHaveLength(1);
  }, TIMEOUT);

  it("stops (stalled) instead of looping when a 'repair' does not change the failure", async () => {
    await setUp("runtime-failure", { test: "node --test" });
    const checks = await discoverChecks(await detectProject(project, nodeProjectFs), nodeProjectFs);
    const ledger = new EvidenceLedger({ now: () => new Date(), newId: (() => { let n = 0; return () => `e${++n}`; })() });
    let calls = 0;
    const result = await repairLoop({
      checks,
      deps: { run: runCommand, ledger, cwd: project, timeoutMs: 60_000 },
      maxAttempts: 5,
      deadlineMs: 120_000,
      now: () => Date.now(),
      repair: async () => {
        calls++;
        await writeFile(path.join(project, "src", "add.mjs"), `${await read("src/add.mjs")}\n// touched\n`);
        return { changed: true, summary: "an edit that does not address the cause" };
      },
    });
    expect(result.outcome).toBe("stalled");
    expect(calls).toBe(1);
    expect(deriveStatus(ledger.entries, ["unit-test"]).status).toBe("FAILED");
  }, TIMEOUT);
});

describe("security weaknesses", () => {
  it("audit and scan find the real problems and never print the secret", async () => {
    await setUp("security", {});
    const audit = await jpe("audit");
    expect(audit.text).toMatch(/\[high\] src\/server\.js:7 .*dynamic code execution/);
    expect(audit.text).toMatch(/\[high\] src\/server\.js:11 .*SQL/);
    expect(audit.text).toMatch(/\[medium\] src\/server\.js:10 .*silently ignored/);
    expect(audit.text).toContain("not a confirmed bug");

    const scan = await jpe("scan");
    expect(scan.code).toBe(1);
    expect(scan.text).toContain("src/server.js:4 anthropic-or-openai-key");
    expect(scan.text).not.toContain("fakefakefakefake");

    const brief = await jpe("brief", "file", "src/server.js");
    expect(brief.text).toContain("Possible risks");
    expect(brief.text).not.toContain("fakefakefakefake");
  }, TIMEOUT);
});

describe("regression next to a pre-existing failure", () => {
  it("a new failure is not hidden behind an old one, and the old one is reported, not 'fixed'", async () => {
    await setUp("regression", { test: "node --test" });

    const baseline = await jpe("verify", "--baseline");
    expect(baseline.text).toContain("FAILING: npm run test");

    // An "improvement" that breaks a function which used to work.
    await edit("src/price.mjs", "return amount - amount * (percent / 100);", "return amount * (percent / 100);");
    const broken = await jpe("verify");
    expect(broken.code).toBe(1);
    expect(broken.text).toContain("STATUS: FAILED");
    expect(broken.text).toContain("now fails differently");
    expect(broken.text).toContain("withDiscount takes the percentage off");

    // Undo it: only the old, known failure remains, and it is labelled as pre-existing.
    git("checkout", "--", "src/price.mjs");
    const restored = await jpe("verify");
    expect(restored.code).toBe(0);
    expect(restored.text).toContain("STATUS: FUNCTIONAL_WITH_WARNINGS");
    expect(restored.text).toContain("existed before this change");
    expect(await read("test/legacy.test.mjs")).toContain("known broken");
  }, TIMEOUT);

  it("the baseline fingerprint is stable across identical runs", async () => {
    await setUp("regression", { test: "node --test" });
    const checks = await discoverChecks(await detectProject(project, nodeProjectFs), nodeProjectFs);
    const a = await captureBaseline(checks, { run: runCommand, cwd: project, timeoutMs: 60_000 });
    const b = await captureBaseline(checks, { run: runCommand, cwd: project, timeoutMs: 60_000 });
    expect([...a.values()]).toEqual([...b.values()]);
    expect([...a.values()][0]?.result).toBe("fail");
  }, TIMEOUT);
});

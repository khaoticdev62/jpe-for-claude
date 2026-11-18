import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvidenceLedger } from "../../src/core/ledger.js";
import { deriveStatus } from "../../src/core/status.js";
import { LspClient } from "../../src/lsp/client.js";
import { checkServer, detectLanguages, findOnPath, listProjectFiles, walkFiles, type PathLookup } from "../../src/lsp/detect.js";
import { collectCliDiagnostics, collectLspDiagnostics, parseCompilerOutput, recordLspEvidence } from "../../src/lsp/diagnostics.js";
import { impactViaLsp, impactViaText } from "../../src/lsp/impact.js";
import { LANGUAGES, getLanguage, languageForFile, planInstall } from "../../src/lsp/registry.js";
import type { RunResult } from "../../src/security/run.js";

const FAKE = fileURLToPath(new URL("../fixtures/fake-lsp.mjs", import.meta.url));
const node = process.execPath;
const ok = (stdout = ""): RunResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false, truncated: false, durationMs: 1 });

describe("registry", () => {
  it("covers the 14 required languages with a server for each", () => {
    expect(LANGUAGES.map((l) => l.id).sort()).toEqual(["c", "cpp", "csharp", "go", "java", "javascript", "kotlin", "lua", "php", "python", "ruby", "rust", "swift", "typescript"]);
    for (const l of LANGUAGES) {
      expect(l.server.binary, l.id).toBeTruthy();
      expect(l.server.install.length > 0 || l.server.manualInstall, `${l.id} needs an install path`).toBeTruthy();
    }
  });
  it("maps files to languages case-insensitively and ignores unknown types", () => {
    expect(languageForFile("src/App.TSX")).toMatchObject({ languageId: "typescriptreact" });
    expect(languageForFile("a.PY")?.language.id).toBe("python");
    expect(languageForFile("x.hpp")?.language.id).toBe("cpp");
    expect(languageForFile("README.md")).toBeUndefined();
  });
  it("plans installs per platform, separating usable from blocked options, and never runs anything", () => {
    const ts = planInstall(getLanguage("typescript"), "linux", (t) => t === "npm");
    expect(ts.available.map((o) => o.args.join(" "))).toEqual(["install -g typescript-language-server typescript"]);
    expect(ts.nativePlugin).toBe("typescript-lsp");
    expect(ts.confidence).toBe("docs");
    const noNpm = planInstall(getLanguage("typescript"), "linux", () => false);
    expect(noNpm.available).toEqual([]);
    expect(noNpm.blocked[0]?.missing).toBe("npm");
    const clangWin = planInstall(getLanguage("c"), "win32", (t) => t === "winget");
    expect(clangWin.available.map((o) => o.file)).toEqual(["winget"]);
    expect(planInstall(getLanguage("swift"), "linux", () => true).manual).toContain("Swift toolchain");
  });
});

describe("detection", () => {
  it("counts languages by extension, most common first", () => {
    const counts = detectLanguages(["a.ts", "b.ts", "c.tsx", "d.py", "e.md", "f.PY", "g.go"]);
    expect(counts.map((c) => [c.language.id, c.files])).toEqual([["typescript", 3], ["python", 2], ["go", 1]]);
  });

  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jpe-lang-"));
    await mkdir(path.join(dir, "src"));
    await mkdir(path.join(dir, "node_modules", "dep"), { recursive: true });
    await writeFile(path.join(dir, "src", "a.ts"), "x");
    await writeFile(path.join(dir, "node_modules", "dep", "i.js"), "x");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  it("walks without entering dependency folders, and prefers git's list when available", async () => {
    expect((await walkFiles(dir)).map((f) => f.replaceAll("\\", "/"))).toEqual(["src/a.ts"]);
    const viaGit = await listProjectFiles(dir, async () => ({ exitCode: 0, stdout: "src/a.ts\0README.md\0" }));
    expect(viaGit).toEqual(["src/a.ts", "README.md"]);
    const notRepo = await listProjectFiles(dir, async () => ({ exitCode: 128, stdout: "" }));
    expect(notRepo.map((f) => f.replaceAll("\\", "/"))).toEqual(["src/a.ts"]);
  });

  const lookup = (present: string[], platform: NodeJS.Platform = "linux"): PathLookup => ({
    platform,
    env: { PATH: platform === "win32" ? "C:\\bin;C:\\tools" : "/usr/bin:/opt/bin", PATHEXT: ".EXE;.CMD" },
    exists: async (f) => present.includes(f),
  });
  it("finds binaries on PATH, honouring PATHEXT on Windows", async () => {
    expect(await findOnPath("gopls", lookup(["/opt/bin/gopls"]))).toBe("/opt/bin/gopls");
    expect(await findOnPath("gopls", lookup([]))).toBeUndefined();
    expect(await findOnPath("tsls", lookup(["C:\\tools\\tsls.cmd"], "win32"))).toBe("C:\\tools\\tsls.cmd");
  });

  it("classifies servers as missing, ready, broken or found-but-unverified", async () => {
    const deps = (present: string[], run: () => Promise<RunResult>) => ({ lookup: lookup(present), run, cwd: ".", timeoutMs: 1000 });
    const go = getLanguage("go");
    expect((await checkServer(go, deps([], async () => ok()))).state).toBe("missing");
    const ready = await checkServer(go, deps(["/usr/bin/gopls"], async () => ok("golang.org/x/tools/gopls v0.16.0\n")));
    expect(ready).toMatchObject({ state: "ready", version: "golang.org/x/tools/gopls v0.16.0" });
    expect((await checkServer(go, deps(["/usr/bin/gopls"], async () => ({ ...ok(), exitCode: 2 })))).state).toBe("broken");
    expect((await checkServer(getLanguage("java"), deps(["/usr/bin/jdtls"], async () => ok()))).state).toBe("found");
  });
});

describe("LspClient against a real protocol server", () => {
  let dir = "";
  let file = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jpe-lspc-"));
    file = path.join(dir, "main.ts");
    await writeFile(file, "class Thing {\n  run() {}\n}\nconst BAD = 1;\n");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("completes the handshake, answers server questions, and returns published diagnostics (empty-then-real)", async () => {
    const client = await LspClient.start({ command: node, args: [FAKE], rootDir: dir, startupTimeoutMs: 5000 });
    try {
      expect(client.serverName).toBe("fake-lsp");
      await client.openFromDisk(file, "typescript");
      const { diagnostics, settled } = await client.waitForDiagnostics([file], 400, 5000);
      expect(settled).toBe(true);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ line: 4, column: 7, severity: "error", message: "BAD token", code: "E1", source: "fake" });
    } finally {
      await client.dispose();
    }
  });

  it("supports symbols, definition, references and hover with 1-based positions", async () => {
    const client = await LspClient.start({ command: node, args: [FAKE], rootDir: dir, startupTimeoutMs: 5000 });
    try {
      const symbols = await client.documentSymbols(file);
      expect(symbols[0]).toMatchObject({ name: "Thing", line: 1, column: 7 });
      expect(symbols[0]?.children[0]).toMatchObject({ name: "run", line: 2 });
      expect((await client.definition(file, { line: 4, column: 7 }))[0]).toMatchObject({ line: 5, column: 2 });
      expect(await client.hover(file, { line: 2, column: 3 })).toContain("function run(): void");
      const impact = await impactViaLsp(client, file, { line: 1, column: 7 });
      expect(impact.method).toBe("lsp");
      expect(impact.referencingFiles.map((r) => [path.basename(r.file), r.count])).toEqual([["a.ts", 2], ["b.ts", 1]]);
    } finally {
      await client.dispose();
    }
  });

  it("rejects unknown requests as errors rather than hanging", async () => {
    const client = await LspClient.start({ command: node, args: [FAKE], rootDir: dir, startupTimeoutMs: 5000 });
    try {
      await expect(client.request("custom/unknown", {}, 3000)).rejects.toThrow(/rejected/);
    } finally {
      await client.dispose();
    }
  });

  it("fails fast when the server dies, and when the command does not exist", async () => {
    const client = await LspClient.start({ command: node, args: [FAKE, "--crash"], rootDir: dir, startupTimeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    await expect(client.request("textDocument/hover", {}, 2000)).rejects.toThrow(/not running|stopped/);
    await client.dispose();
    await expect(LspClient.start({ command: "no-such-language-server-xyz", args: [], rootDir: dir, startupTimeoutMs: 2000 })).rejects.toThrow();
  });
});

describe("diagnostics collection", () => {
  let dir = "";
  let file = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jpe-diag-"));
    file = path.join(dir, "main.ts");
    await writeFile(file, "ok\nBAD here\n");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const ts = getLanguage("typescript");

  it("collects real LSP diagnostics and records them as LSP evidence", async () => {
    const report = await collectLspDiagnostics(ts, { command: node, args: [FAKE], rootDir: dir, files: [file], readFile: async () => "ok\nBAD here\n", startupTimeoutMs: 5000, settleMs: 300 });
    expect(report).toMatchObject({ source: "lsp", server: "fake-lsp", errors: 1, warnings: 0 });
    const ledger = new EvidenceLedger({ now: () => new Date(0), newId: () => "e1" });
    recordLspEvidence(ledger, report);
    expect(ledger.entries[0]).toMatchObject({ kind: "lsp", available: true, errors: 1 });
    expect(deriveStatus(ledger.entries, ["typecheck"]).status).toBe("FAILED");
  });

  it("reports a server that cannot start as unavailable, never as a pass", async () => {
    const report = await collectLspDiagnostics(ts, { command: "no-such-language-server-xyz", args: [], rootDir: dir, files: [file], readFile: async () => "", startupTimeoutMs: 1000 });
    expect(report.source).toBe("none");
    expect(report.notes[0]).toContain("did not start");
    const ledger = new EvidenceLedger({ now: () => new Date(0), newId: () => "e1" });
    recordLspEvidence(ledger, report);
    expect(deriveStatus(ledger.entries, ["typecheck"]).status).toBe("NOT_TESTED");
  });

  it("CLI fallback parses compiler output and is never recorded as LSP evidence", async () => {
    const out = `${path.join(dir, "main.ts")}(2,5): error TS2322: Type 'string' is not assignable to type 'number'.`;
    const report = await collectCliDiagnostics(ts, { run: async () => ({ ...ok(out), exitCode: 2 }), cwd: dir, timeoutMs: 1000 });
    expect(report).toMatchObject({ source: "cli", errors: 1, server: "npx (CLI fallback)" });
    expect(report.notes[0]).toContain("not from a language server");
    const ledger = new EvidenceLedger({ now: () => new Date(0), newId: () => "e1" });
    recordLspEvidence(ledger, report);
    expect(ledger.entries[0]).toMatchObject({ kind: "lsp", available: false, errors: 0 });
    expect((await collectCliDiagnostics(getLanguage("java"))).source).toBe("none");
  });
});

describe("parseCompilerOutput", () => {
  const cwd = path.resolve("proj");
  it("reads tsc/MSBuild, GNU/go vet and rustc formats", () => {
    const text = [
      "src/a.ts(3,7): error TS2304: Cannot find name 'x'.",
      "Program.cs(10,5): warning CS0168: The variable 'e' is declared but never used [C:\\p\\app.csproj]",
      "pkg/main.go:12:2: undefined: foo",
      "lib.c:4:9: warning: unused variable 'y'",
      "error[E0425]: cannot find value `z` in this scope",
      " --> src/main.rs:2:5",
      "unrelated line",
    ].join("\n");
    const d = parseCompilerOutput(text, cwd);
    expect(d.map((x) => [path.basename(x.file), x.line, x.column, x.severity, x.code])).toEqual([
      ["a.ts", 3, 7, "error", "TS2304"],
      ["Program.cs", 10, 5, "warning", "CS0168"],
      ["main.go", 12, 2, "error", undefined],
      ["lib.c", 4, 9, "warning", undefined],
      ["main.rs", 2, 5, "error", "E0425"],
    ]);
    expect(d[1]?.message).toBe("The variable 'e' is declared but never used");
  });
  it("returns nothing for clean output", () => {
    expect(parseCompilerOutput("Compiled successfully.\n", cwd)).toEqual([]);
  });
});

describe("text-search impact fallback", () => {
  const root = path.resolve("proj");
  const files: Record<string, string> = {
    "src/util.ts": "export const u = 1;",
    "src/a.ts": "import { u } from './util';\nimport x from '../lib/other';\n",
    "src/b.ts": "const m = require('./util.js'); import('./util');",
    "src/c.ts": "import { u } from './utility';",
    "lib/other.ts": "",
    "pkg/core.py": "x = 1",
    "pkg/use.py": "from pkg.core import x\nimport pkg.core\n",
    "pkg/skip.py": "import pkg.core_extra",
  };
  const deps = { root, listFiles: async () => Object.keys(files), readText: async (f: string) => files[path.relative(root, f).split(path.sep).join("/")] };

  it("finds importers of a TS module (extension-insensitive) and not look-alikes", async () => {
    const r = await impactViaText("src/util.ts", deps);
    expect(r.method).toBe("text-search");
    expect(r.referencingFiles.map((f) => [path.basename(f.file), f.count])).toEqual([["b.ts", 2], ["a.ts", 1]]);
    expect(r.limitations[0]).toContain("cannot tell which functions");
  });
  it("finds Python importers by dotted module name", async () => {
    const r = await impactViaText("pkg/core.py", deps);
    expect(r.referencingFiles.map((f) => [path.basename(f.file), f.count])).toEqual([["use.py", 2]]);
  });
  it("says so when the language is not supported", async () => {
    const r = await impactViaText("main.go", deps);
    expect(r.referencingFiles).toEqual([]);
    expect(r.limitations.join(" ")).toContain("install a language server");
  });
});

// Real-server integration: runs only where typescript-language-server (and typescript) are installed.
const realTs = await findOnPath("typescript-language-server", { platform: process.platform, env: process.env, exists: async (f) => (await import("node:fs")).existsSync(f) });
describe.skipIf(!realTs)("real typescript-language-server", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jpe-realts-"));
    await writeFile(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler" }, include: ["*.ts"] }));
    await writeFile(path.join(dir, "bad.ts"), 'export const n: number = "not a number";\nexport function add(a: number, b: number): number { return a + b; }\n');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("reports the genuine type error, hover text and symbols", async () => {
    const file = path.join(dir, "bad.ts");
    const ts = getLanguage("typescript");
    const report = await collectLspDiagnostics(ts, { command: realTs as string, args: ts.server.args, rootDir: dir, files: [file], readFile: async () => (await import("node:fs/promises")).readFile(file, "utf8"), startupTimeoutMs: 30_000, settleMs: 2500, maxWaitMs: 40_000 });
    expect(report.source).toBe("lsp");
    expect(report.diagnostics.some((d) => d.severity === "error" && d.code === "2322" && d.line === 1)).toBe(true);

    const client = await LspClient.start({ command: realTs as string, args: ts.server.args, rootDir: dir, startupTimeoutMs: 30_000 });
    try {
      await client.openFromDisk(file, "typescript");
      const symbols = await client.documentSymbols(file);
      expect(symbols.map((s) => s.name)).toEqual(expect.arrayContaining(["n", "add"]));
      expect(await client.hover(file, { line: 2, column: 17 })).toContain("add");
    } finally {
      await client.dispose();
    }
  }, 120_000);
});

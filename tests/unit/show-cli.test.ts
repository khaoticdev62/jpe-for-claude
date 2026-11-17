import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { COMMAND_NAMES, runCli } from "../../src/cli/main.js";
import { displayWidth, stripAnsi } from "../../src/ui/text.js";

const ESC = "\u001b";
let base = "";
let project = "";
let out: string[] = [];
let err: string[] = [];

type GitStub = (args: readonly string[]) => Promise<{ exitCode: number; stdout: string }>;

/** A stand-in for git: `files` is what HEAD holds, `porcelain` is `git status --porcelain -z`. */
const gitFor = (over: { repo?: boolean; head?: Record<string, string>; porcelain?: string } = {}): GitStub => async (args) => {
  if (over.repo === false) return { exitCode: 128, stdout: "" };
  if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { exitCode: 0, stdout: "true\n" };
  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { exitCode: 0, stdout: `${project}\n` };
  if (args[0] === "symbolic-ref") return { exitCode: 0, stdout: "main\n" };
  if (args[0] === "status") return { exitCode: 0, stdout: over.porcelain ?? "" };
  if (args[0] === "show") {
    const rel = String(args[1]).replace(/^HEAD:/, "");
    const text = over.head?.[rel];
    return text === undefined ? { exitCode: 128, stdout: "" } : { exitCode: 0, stdout: text };
  }
  if (args[0] === "ls-files") return { exitCode: 128, stdout: "" }; // so the project's files are found by walking the folder
  return { exitCode: 0, stdout: "" };
};

function makeCtx(over: Partial<CliContext> = {}): CliContext {
  return createContext({
    cwd: project,
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), LANG: "en_US.UTF-8", PATH: "" }, homedir: base },
    git: gitFor(),
    terminal: () => ({ isTTY: false, columns: undefined, rows: undefined }),
    now: () => new Date("2026-03-04T12:00:00.000Z"),
    ...over,
  });
}
const run = (argv: string[], over?: Partial<CliContext>): Promise<number> => runCli(argv, makeCtx(over));
const stdout = (): string => out.join("\n");
const stderr = (): string => err.join("\n");
const write = async (rel: string, text: string): Promise<void> => {
  await mkdir(path.dirname(path.join(project, rel)), { recursive: true });
  await writeFile(path.join(project, rel), text);
};

const SOURCE = 'import fs from "node:fs";\nexport function run(input) {\n  const answer = eval(input);\n  return answer;\n}\n';

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-show-"));
  project = path.join(base, "proj");
  await mkdir(project);
  out = [];
  err = [];
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("jpe show: usage", () => {
  it("is registered and listed in help", async () => {
    expect(COMMAND_NAMES).toContain("show");
    await run(["help"]);
    expect(stdout()).toMatch(/show file <path> \| change <path> \| review/);
  });
  it("explains itself when called without or with a wrong view", async () => {
    expect(await run(["show"])).toBe(1);
    expect(stderr()).toContain("Usage: jpe show <file|change|review|impact|docs|diagnostics>");
    err = [];
    expect(await run(["show", "bogus"])).toBe(1);
    expect(stderr()).toContain("Usage: jpe show");
  });
});

describe("jpe show file", () => {
  it("shows the code with the risk on its line, beside the structure, as plain text when piped", async () => {
    await write("src/run.js", SOURCE);
    expect(await run(["show", "file", "src/run.js", "--width", "120"])).toBe(0);
    expect(stdout()).toContain("src/run.js (js)");
    expect(stdout()).toMatch(/3 │ {3}const answer = eval\(input\);/);
    expect(stdout()).toContain("high risk");
    expect(stdout()).toContain("Structure");
    expect(stdout()).toContain("function run(input)");
    expect(stdout()).not.toContain(ESC);
  });
  it("--json is the analysis itself", async () => {
    await write("src/run.js", SOURCE);
    expect(await run(["show", "file", "src/run.js", "--json"])).toBe(0);
    const json = JSON.parse(stdout());
    expect(json.file).toBe("src/run.js");
    expect(json.symbols[0]).toMatchObject({ kind: "function", name: "run" });
    expect(json.risks[0]).toMatchObject({ id: "dynamic-eval", line: 3 });
  });
  it("limits long files unless --all, and starts sections closed with --collapse", async () => {
    await write("big.ts", Array.from({ length: 200 }, (_, i) => `export const v${i} = ${i};`).join("\n"));
    await run(["show", "file", "big.ts", "--width", "120"]);
    expect(stdout()).toContain("… 120 more lines");
    out = [];
    await run(["show", "file", "big.ts", "--width", "120", "--all"]);
    expect(stdout()).not.toContain("more lines");
    out = [];
    await run(["show", "file", "big.ts", "--width", "120", "--collapse"]);
    expect(stdout()).toMatch(/▸ Symbols/);
  });
  it("refuses a path outside the project and a missing file, in plain words", async () => {
    expect(await run(["show", "file", "../outside.ts"])).toBe(1);
    expect(stderr()).toMatch(/jpe:/);
    err = [];
    expect(await run(["show", "file", "nope.ts"])).toBe(1);
    expect(stderr()).toContain("is not a readable file in this project");
    err = [];
    expect(await run(["show", "file"])).toBe(1);
  });
  it("never lets file content drive the terminal, and keeps within the width", async () => {
    await write("evil.js", `const a = "${ESC}[2J${ESC}]0;pwned\u0007";\n${"x".repeat(300)}\n`);
    for (const width of [20, 40, 80]) {
      out = [];
      expect(await run(["show", "file", "evil.js", "--width", String(width)], { terminal: () => ({ isTTY: true, columns: 200, rows: 50 }) })).toBe(0);
      expect(stdout()).not.toContain(`${ESC}[2J`);
      expect(stdout()).not.toContain(`${ESC}]0;`);
      for (const line of stdout().split("\n")) expect(displayWidth(stripAnsi(line)), `@${width}`).toBeLessThanOrEqual(width);
    }
  });
});

describe("jpe show change", () => {
  it("shows a diff against the committed version", async () => {
    await write("a.js", "function a() {\n  return 2;\n}\n");
    await run(["show", "change", "a.js"], { git: gitFor({ head: { "a.js": "function a() {\n  return 1;\n}\n" } }) });
    expect(stdout()).toContain("+1 lines added, -1 lines removed");
    expect(stdout()).toMatch(/^- {3}return 1;$/m);
    expect(stdout()).toMatch(/^\+ {3}return 2;$/m);
  });
  it("says so for a new file, counting every line as added and none as removed", async () => {
    await write("new.js", "const a = 1;\nconst b = 2;\n");
    await run(["show", "change", "new.js"]);
    expect(stdout()).toContain("has no committed version");
    expect(stdout()).toContain("+2 lines added, -0 lines removed");
  });
  it("says plainly when nothing changed", async () => {
    await write("same.js", "const a = 1;\n");
    await run(["show", "change", "same.js"], { git: gitFor({ head: { "same.js": "const a = 1;\n" } }) });
    expect(stdout()).toContain("No changes compared with the committed version.");
  });
  it("--json is the change summary", async () => {
    await write("a.js", "a\nb\n");
    await run(["show", "change", "a.js", "--json"], { git: gitFor({ head: { "a.js": "a\n" } }) });
    expect(JSON.parse(stdout())).toMatchObject({ file: "a.js", added: 1, removed: 0 });
  });
});

describe("jpe show review", () => {
  const porcelain = " M src/a.js\0?? src/b.js\0 D src/gone.js\0 M tests/a.test.js\0";
  const setupReview = async (): Promise<Partial<CliContext>> => {
    await write("src/a.js", "const x = 1;\nconst y = eval(code);\n");
    await write("src/b.js", "export const b = 1;\n");
    await write("tests/a.test.js", "test();\ntest2();\n");
    return { git: gitFor({ head: { "src/a.js": "const x = 1;\n", "src/gone.js": "export function old() {}\n", "tests/a.test.js": "test();\n" }, porcelain }) };
  };

  it("reviews every uncommitted file: overview, notes with their basis, checklist and diffs", async () => {
    const ctx = await setupReview();
    expect(await run(["show", "review", "--width", "110"], ctx)).toBe(0);
    expect(stdout()).toContain("Code review of uncommitted changes");
    expect(stdout()).toContain("4 files changed. 1 possible risk introduced (pattern matches, not proof).");
    expect(stdout()).toMatch(/src\/a\.js\s+│ modified\s+│ \+1 -0\s+│ 1 high/);
    expect(stdout()).toMatch(/src\/b\.js\s+│ added/);
    expect(stdout()).toMatch(/src\/gone\.js\s+│ deleted/);
    expect(stdout()).toMatch(/tests\/a\.test\.js\s+│ modified, test/);
    expect(stdout()).toContain("[confirmed] src/a.js:2 introduces a possible high risk (a pattern match, not proof)");
    expect(stdout()).toContain("1 file was deleted: src/gone.js.");
    expect(stdout()).toContain("Checklist for the reviewer");
    expect(stdout()).toMatch(/^ +\+ const y = eval\(code\);$/m);
  });
  it("--json carries the files, the notes, the checklist and what was skipped", async () => {
    const ctx = await setupReview();
    await run(["show", "review", "--json"], ctx);
    const json = JSON.parse(stdout());
    expect(Object.keys(json).sort()).toEqual(["checklist", "files", "notes", "skipped"]);
    expect(json.files).toHaveLength(4);
    expect(json.notes.some((n: { basis: string }) => n.basis === "confirmed")).toBe(true);
  });
  it("says there is nothing to review in a clean repository", async () => {
    await run(["show", "review"], { git: gitFor({ porcelain: "" }) });
    expect(stdout()).toContain("There are no uncommitted changes to review.");
  });
  it("lists what it could not analyse, with the reason", async () => {
    await write("big.txt", "x".repeat(450_000));
    await run(["show", "review", "--width", "100"], { git: gitFor({ porcelain: "?? big.txt\0?? missing.bin\0" }) });
    expect(stdout()).toContain("There are uncommitted changes, but none of the changed files could be analysed.");
    expect(stdout()).not.toContain("no uncommitted changes");
    expect(stdout()).toContain("big.txt (over 400 KB)");
    expect(stdout()).toContain("missing.bin (not readable as text)");
  });
  it("explains when this is not a git repository", async () => {
    expect(await run(["show", "review"], { git: gitFor({ repo: false }) })).toBe(1);
    expect(stderr()).toContain("not a git repository");
  });
  it("changes nothing in the project", async () => {
    const ctx = await setupReview();
    const before = (await readdir(project, { recursive: true })).sort();
    await run(["show", "review"], ctx);
    await run(["show", "file", "src/a.js"], ctx);
    expect((await readdir(project, { recursive: true })).sort()).toEqual(before);
  });
});

describe("jpe show impact", () => {
  it("lists the files that import a file, and says the answer is approximate", async () => {
    await write("src/a.js", "export const a = 1;\n");
    await write("src/b.js", 'import { a } from "./a.js";\nexport const b = a;\n');
    await write("src/c.js", 'import { a } from "./a.js";\nimport { b } from "./b.js";\n');
    await run(["show", "impact", "src/a.js", "--width", "90"], { git: gitFor() });
    expect(stdout()).toContain("What depends on src/a.js");
    expect(stdout()).toContain("approximate: found by scanning import statements");
    expect(stdout()).toContain("src/b.js");
    expect(stdout()).toContain("src/c.js");
    expect(stdout()).toContain("What this cannot see");
  });
  it("--json is the report and the notes", async () => {
    await write("src/a.js", "export const a = 1;\n");
    await run(["show", "impact", "src/a.js", "--json"]);
    expect(Object.keys(JSON.parse(stdout())).sort()).toEqual(["notes", "report"]);
  });
  it("needs a file", async () => {
    expect(await run(["show", "impact"])).toBe(1);
    expect(stderr()).toContain("Usage: jpe impact");
  });
});

describe("jpe show docs", () => {
  beforeEach(async () => {
    await write("package.json", JSON.stringify({ name: "p", dependencies: { foo: "1.2.3" } }));
    await write("node_modules/foo/package.json", JSON.stringify({ name: "foo", version: "1.2.3", description: "A test library", types: "index.d.ts" }));
    await write("node_modules/foo/README.md", "# foo\n\nThe old() function is deprecated; use fresh() instead.\n");
    await write("node_modules/foo/index.d.ts", "export declare function fresh(x: number): string;\n");
  });

  it("researches offline from the installed package, showing provenance and quoting a deprecation", async () => {
    expect(await run(["show", "docs", "foo", "--offline", "--width", "120"])).toBe(0);
    expect(stdout()).toContain("Documentation: foo@1.2.3");
    expect(stdout()).toContain("offline: network sources were not contacted");
    expect(stdout()).toContain("fresh this run");
    expect(stdout()).toContain("local");
    expect(stdout()).toContain("The documentation says: The old() function is deprecated; use fresh() instead.");
    expect(stdout()).toContain("Sources");
  });
  it("--find lists only the lines that mention the text", async () => {
    await run(["show", "docs", "foo", "--offline", "--find", "fresh"]);
    expect(stdout()).toContain('Lines mentioning "fresh"');
    expect(stdout()).toMatch(/\[\d\] .*fresh/);
  });
  it("--json carries the report, with each source's text limited in length", async () => {
    await run(["show", "docs", "foo", "--offline", "--json"]);
    const json = JSON.parse(stdout());
    expect(json.report.request.library).toBe("foo");
    expect(json.report.results.length).toBeGreaterThan(0);
  });
  it("needs a library", async () => {
    expect(await run(["show", "docs"])).toBe(1);
    expect(stderr()).toContain("Usage: jpe research");
  });
});

describe("jpe show diagnostics", () => {
  it("needs a file, and refuses one JPE has no language entry for", async () => {
    expect(await run(["show", "diagnostics"])).toBe(1);
    expect(stderr()).toContain("Usage: jpe lsp diagnostics");
    err = [];
    await write("README.md", "hi");
    expect(await run(["show", "diagnostics", "README.md"])).toBe(1);
    expect(stderr()).toContain("no language server entry");
  });
});

describe("display flags apply to every view", () => {
  it("stays within the width and has no box drawing for a screen reader", async () => {
    await write("src/run.js", SOURCE);
    for (const width of [20, 30, 60]) {
      out = [];
      await run(["show", "file", "src/run.js", "--width", String(width)]);
      for (const line of stdout().split("\n")) expect(displayWidth(line), `@${width}: ${line}`).toBeLessThanOrEqual(width);
    }
    out = [];
    await run(["show", "file", "src/run.js", "--screen-reader"]);
    expect(stdout()).toContain("Note on line 3 (error: high risk:");
    expect(stdout()).not.toMatch(/[│▲✘╭]/);
  });
  it("paints in the theme's colours on a colour terminal", async () => {
    await write("src/run.js", SOURCE);
    await run(["show", "file", "src/run.js", "--width", "120"], { terminal: () => ({ isTTY: true, columns: 120, rows: 40 }), pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), LANG: "en_US.UTF-8", COLORTERM: "truecolor", PATH: "" }, homedir: base } });
    expect(stdout()).toContain(`${ESC}[38;2;199;146;234mexport`); // the keyword colour of the default theme, #C792EA
    expect(stdout()).toContain(`${ESC}[38;2;255;107;107m`); // the error colour, on the annotation
  });
});

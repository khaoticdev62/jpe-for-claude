import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverChecks } from "../../src/project/checks.js";
import { detectProject } from "../../src/project/detect.js";
import { nodeProjectFs, type ProjectFs } from "../../src/project/fs.js";
import { createGitRunner, parsePorcelain, readGitState } from "../../src/project/git.js";

/** In-memory filesystem keyed by forward-slash paths relative to the project root. */
function memFs(files: Record<string, string>): ProjectFs {
  const norm = (p: string): string => p.replaceAll("\\", "/").replace(/^\/?root\//, "");
  return {
    readText: async (p) => files[norm(p)],
    exists: async (p) => norm(p) in files,
  };
}

describe("detectProject (node)", () => {
  const pkg = JSON.stringify({
    scripts: { test: "vitest run", build: "tsup", typecheck: "tsc --noEmit", lint: "eslint .", "bad name!": "x" },
    dependencies: { zod: "^4.0.0", "../evil": "1.0.0" },
    devDependencies: { typescript: "^5.0.0", vitest: "^2.0.0" },
  });
  const files = {
    "package.json": pkg,
    "package-lock.json": JSON.stringify({ packages: { "node_modules/zod": { version: "4.1.2" }, "node_modules/vitest": { version: "2.1.9" } } }),
    "node_modules/typescript/package.json": JSON.stringify({ version: "5.6.3" }),
    "CLAUDE.md": "# rules",
  };

  it("reports ecosystem, package manager and exact versions with their source", async () => {
    const info = await detectProject("root", memFs(files));
    expect(info.ecosystems).toEqual(["node"]);
    expect(info.packageManager).toBe("npm");
    expect(info.hasLockfile).toBe(true);
    const byName = Object.fromEntries(info.dependencies.map((d) => [d.name, d]));
    expect(byName["typescript"]).toMatchObject({ version: "5.6.3", versionSource: "installed", dev: true });
    expect(byName["zod"]).toMatchObject({ version: "4.1.2", versionSource: "lockfile", declared: "^4.0.0" });
    expect(info.instructionFiles).toEqual(["CLAUDE.md"]);
  });

  it("skips path-traversal dependency names and says so", async () => {
    const info = await detectProject("root", memFs(files));
    expect(info.dependencies.map((d) => d.name)).not.toContain("../evil");
    expect(info.warnings.join(" ")).toContain("unusual name");
  });

  it("only has a declared range when nothing is installed or locked", async () => {
    const info = await detectProject("root", memFs({ "package.json": pkg }));
    const zod = info.dependencies.find((d) => d.name === "zod");
    expect(zod?.versionSource).toBe("declared");
    expect(zod?.version).toBeUndefined();
    expect(info.hasLockfile).toBe(false);
  });

  it("picks the manager from the lockfile and survives malformed manifests", async () => {
    const pnpm = await detectProject("root", memFs({ "package.json": "{}", "pnpm-lock.yaml": "" }));
    expect(pnpm.packageManager).toBe("pnpm");
    const bad = await detectProject("root", memFs({ "package.json": "{nope" }));
    expect(bad.ecosystems).toEqual(["node"]);
    expect(bad.warnings).toHaveLength(1);
  });
});

describe("detectProject (other ecosystems)", () => {
  it("reads Cargo, go.mod and requirements pins", async () => {
    const info = await detectProject(
      "root",
      memFs({
        "Cargo.toml": '[package]\nname="x"\n[dependencies]\nserde = "1.0"\ntokio = { version = "1.2", features = ["full"] }\n[dev-dependencies]\ncriterion = "0.5"\n',
        "Cargo.lock": '[[package]]\nname = "serde"\nversion = "1.0.200"\n',
        "go.mod": "module x\n\nrequire (\n\tgithub.com/pkg/errors v0.9.1\n)\n",
        "requirements.txt": "requests==2.31.0\nflask>=2.0\n# comment\n",
      }),
    );
    expect(info.ecosystems).toEqual(["rust", "go", "python"]);
    const get = (n: string) => info.dependencies.find((d) => d.name === n);
    expect(get("serde")).toMatchObject({ version: "1.0.200", versionSource: "lockfile" });
    expect(get("tokio")).toMatchObject({ declared: "1.2", versionSource: "declared" });
    expect(get("criterion")?.dev).toBe(true);
    expect(get("github.com/pkg/errors")?.version).toBe("v0.9.1");
    expect(get("requests")?.version).toBe("2.31.0");
    expect(get("flask")?.version).toBeUndefined();
  });
});

describe("discoverChecks", () => {
  it("maps project scripts, infers tsc only without a typecheck script, and ignores the npm placeholder test", async () => {
    const files = {
      "package.json": JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1', build: "tsup" },
        devDependencies: { typescript: "^5" },
      }),
      "package-lock.json": "{}",
    };
    const fs = memFs(files);
    const checks = await discoverChecks(await detectProject("root", fs), fs);
    expect(checks.map((c) => [c.check, c.source])).toEqual([
      ["build", "script"],
      ["typecheck", "inferred"],
      ["dependency-audit", "convention"],
    ]);
    expect(checks.find((c) => c.check === "typecheck")?.args).toEqual(["--no-install", "tsc", "--noEmit"]);
  });

  it("uses scripts verbatim through the detected package manager", async () => {
    const fs = memFs({ "package.json": JSON.stringify({ scripts: { test: "vitest run", typecheck: "tsc" } }), "pnpm-lock.yaml": "" });
    const checks = await discoverChecks(await detectProject("root", fs), fs);
    expect(checks.find((c) => c.check === "unit-test")).toMatchObject({ file: "pnpm", args: ["run", "test"] });
    expect(checks.find((c) => c.check === "dependency-audit")?.args).toEqual(["audit"]);
  });

  it("finds nothing for an empty project and never invents tests", async () => {
    const fs = memFs({});
    expect(await discoverChecks(await detectProject("root", fs), fs)).toEqual([]);
  });

  it("detects configured python tools and standard go/rust commands", async () => {
    const fs = memFs({ "pyproject.toml": "[tool.pytest.ini_options]\n[tool.ruff]\n", "go.mod": "module x\n", "Cargo.toml": "[package]\n" });
    const displays = (await discoverChecks(await detectProject("root", fs), fs)).map((c) => c.display);
    expect(displays).toEqual(expect.arrayContaining(["python -m pytest", "ruff check .", "go test ./...", "cargo check"]));
    expect(displays).not.toContain("mypy .");
  });
});

describe("git state", () => {
  it("parses porcelain output including renames and untracked files", () => {
    const out = " M src/a.ts\0?? new file.ts\0R  new.ts\0old.ts\0";
    expect(parsePorcelain(out)).toEqual([
      { status: " M", path: "src/a.ts" },
      { status: "??", path: "new file.ts" },
      { status: "R ", path: "new.ts" },
    ]);
  });

  describe("against a real repository", () => {
    let dir = "";
    const git = (...args: string[]): void => {
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.test", ...args], { cwd: dir, stdio: "ignore" });
    };
    beforeAll(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "jpe-git-"));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("reports not-a-repo outside git", async () => {
      const state = await readGitState(createGitRunner(dir));
      expect(state).toMatchObject({ available: true, isRepo: false, dirty: false });
    });

    it("reports branch, clean and dirty states", async () => {
      git("init", "-q", "-b", "main");
      await writeFile(path.join(dir, "a.txt"), "1");
      git("add", "-A");
      git("commit", "-q", "-m", "init");
      const clean = await readGitState(createGitRunner(dir));
      expect(clean).toMatchObject({ isRepo: true, branch: "main", dirty: false });

      await writeFile(path.join(dir, "a.txt"), "2");
      await mkdir(path.join(dir, "sub"));
      await writeFile(path.join(dir, "sub", "b.txt"), "x");
      const dirty = await readGitState(createGitRunner(dir));
      expect(dirty.dirty).toBe(true);
      expect(dirty.changedFiles.map((f) => f.path).sort()).toEqual(["a.txt", "sub/b.txt"]);
    });
  });
});

describe("nodeProjectFs", () => {
  it("returns undefined for missing files and for directories", async () => {
    expect(await nodeProjectFs.readText(path.join(tmpdir(), "jpe-definitely-missing.json"))).toBeUndefined();
    expect(await nodeProjectFs.readText(tmpdir())).toBeUndefined();
    expect(await nodeProjectFs.exists(tmpdir())).toBe(true);
  });
});

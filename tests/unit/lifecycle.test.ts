import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, projectKey, type CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";
import { defaultConfig } from "../../src/config/defaults.js";
import type { NetDeps } from "../../src/docs/net.js";
import { onSessionStart } from "../../src/hooks/handlers.js";
import { parsePayload } from "../../src/hooks/payload.js";
import { executeRemoval, formatBytes, isStrictlyInside, type Inventory, pathStats, planRemoval, REMOVAL_SCOPES, scanInventory } from "../../src/lifecycle/inventory.js";
import { aboutView, dataView, removalView } from "../../src/lifecycle/views.js";
import { checkAgainstManifest, compareVersions, describeVersionChange, PACKAGE_VERSION, parseVersion, readSeenVersion, recordSeenVersion } from "../../src/lifecycle/version.js";
import { assessCommand } from "../../src/security/risk.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { lineWidth } from "../../src/ui/doc.js";
import { resolveProfile } from "../../src/ui/profile.js";

const T0 = Date.UTC(2026, 2, 4, 12, 0, 0);
const profile = (width: number) => resolveProfile(detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false, columns: width, rows: 40 }), defaultConfig().ui);
const text = (lines: ReadonlyArray<ReadonlyArray<{ text: string }>>): string => lines.map((l) => l.map((s) => s.text).join("")).join("\n");

describe("versions", () => {
  it("reads plain x.y.z versions and nothing else", () => {
    expect(parseVersion("1.9.0")).toEqual([1, 9, 0]);
    expect(parseVersion(" 10.20.30 ")).toEqual([10, 20, 30]);
    for (const bad of ["1.9", "1.9.0-beta", "v1.9.0", "1.9.0.1", "", "latest", "1..0", "1.9.x", "1234567.0.0"]) expect(parseVersion(bad), bad).toBeUndefined();
  });
  it("compares them numerically, not as text", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.9.0", "nonsense")).toBeUndefined();
  });
  it("says nothing on the first run or when the version is the same, and names a change", () => {
    expect(describeVersionChange(undefined, "1.9.0")).toEqual({ kind: "first" });
    expect(describeVersionChange("1.9.0", "1.9.0")).toEqual({ kind: "same" });
    expect(describeVersionChange("1.8.0", "1.9.0")).toMatchObject({ kind: "updated", message: "JPE was updated from 1.8.0 to 1.9.0. What changed is in CHANGELOG.md in the plugin folder, or on GitHub." });
    expect(describeVersionChange("2.0.0", "1.9.0")).toMatchObject({ kind: "changed", message: "JPE is now version 1.9.0 (it was 2.0.0)." });
  });
  it("judges a published manifest without guessing", () => {
    const manifest = (version: unknown): string => JSON.stringify({ name: "jpe", version });
    expect(checkAgainstManifest("1.9.0", manifest("1.9.0"))).toMatchObject({ state: "up-to-date", latest: "1.9.0" });
    expect(checkAgainstManifest("1.9.0", manifest("1.10.0"))).toMatchObject({ state: "update-available", latest: "1.10.0" });
    expect(checkAgainstManifest("1.9.0", manifest("1.8.0"))).toMatchObject({ state: "ahead" });
    for (const bad of ["{ nope", "{}", manifest(5), manifest("1.9"), manifest("2.0.0-rc1")]) expect(checkAgainstManifest("1.9.0", bad).state, bad).toBe("unknown");
    expect(checkAgainstManifest("dev", manifest("1.9.0")).state).toBe("unknown");
  });
});

describe("the data inventory and removal", () => {
  let base = "";
  let root = "";
  let project = "";
  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "jpe-life-"));
    root = path.join(base, "data");
    project = path.join(root, "projects", "aaaaaaaaaaaa");
    await mkdir(path.join(project, "backups", "bk1"), { recursive: true });
    await mkdir(path.join(root, "projects", "bbbbbbbbbbbb", "backups"), { recursive: true });
    await mkdir(path.join(root, "docs-cache"), { recursive: true });
    await writeFile(path.join(root, "config.json"), "{}");
    await writeFile(path.join(root, "config.json.bak-2026"), "{}");
    await writeFile(path.join(root, "version.json"), "{}");
    await writeFile(path.join(root, "docs-cache", "a.json"), "x".repeat(100));
    await writeFile(path.join(project, "tasks.json"), "[]");
    await writeFile(path.join(project, "events.jsonl"), "line\n");
    await writeFile(path.join(project, "backups", "bk1", "file.bak"), "y".repeat(50));
    await writeFile(path.join(root, "projects", "bbbbbbbbbbbb", "tasks.json"), "[]");
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("counts files and bytes, and a missing path is empty", async () => {
    expect(await pathStats(path.join(root, "docs-cache"))).toMatchObject({ files: 1, bytes: 100, truncated: false });
    expect(await pathStats(path.join(root, "nothing"))).toMatchObject({ files: 0, bytes: 0, newestMs: 0 });
    expect((await pathStats(root)).files).toBe(8);
  });
  it("stops early on a huge folder and says the numbers are lower bounds", async () => {
    const stats = await pathStats(root, 3);
    expect(stats.truncated).toBe(true);
  });
  it("does not follow a symlink out of the data folder", async () => {
    const outside = path.join(base, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "big.txt"), "z".repeat(5000));
    try {
      await symlink(outside, path.join(root, "link"), "junction");
    } catch {
      return; // creating links is not permitted here; nothing to check
    }
    expect((await pathStats(path.join(root, "link"))).bytes).toBeLessThan(5000);
  });
  it("groups the inventory by what things are, and marks the current project", async () => {
    const inv = await scanInventory(root, "aaaaaaaaaaaa");
    expect(inv.settings.files).toBe(2);
    expect(inv.docsCache.files).toBe(1);
    expect(inv.other.files).toBe(1);
    const mine = inv.projects.find((p) => p.key === "aaaaaaaaaaaa");
    expect(mine).toMatchObject({ current: true });
    expect(mine?.records.files).toBe(2);
    expect(mine?.backups.files).toBe(1);
    expect(inv.projects.find((p) => p.key === "bbbbbbbbbbbb")?.current).toBe(false);
    expect(inv.total.files).toBe(8);
  });
  it("an empty or missing data folder is an empty inventory", async () => {
    const inv = await scanInventory(path.join(base, "none"), "x");
    expect(inv.total.files).toBe(0);
    expect(inv.projects).toEqual([]);
  });

  it("plans each scope to touch only what it says", async () => {
    const rel = (plan: { targets: string[] }): string[] => plan.targets.map((t) => path.relative(root, t).split(path.sep).join("/")).sort();
    expect(rel(await planRemoval("cache", root, project))).toEqual(["docs-cache"]);
    expect(rel(await planRemoval("records", root, project))).toEqual(["projects/aaaaaaaaaaaa/events.jsonl", "projects/aaaaaaaaaaaa/tasks.json"]);
    expect(rel(await planRemoval("backups", root, project))).toEqual(["projects/aaaaaaaaaaaa/backups"]);
  });
  it("`all` is an allow-list of JPE's own names and never whatever else is in the folder", async () => {
    await writeFile(path.join(root, "my-notes.txt"), "not JPE's");
    await mkdir(path.join(root, "other-tool"));
    const plan = await planRemoval("all", root, project);
    const names = plan.targets.map((t) => path.basename(t)).sort();
    expect(names).toEqual(["config.json", "config.json.bak-2026", "docs-cache", "projects", "version.json"]);
    expect(names).not.toContain("my-notes.txt");
    expect(names).not.toContain("other-tool");
  });
  it("each plan says what is lost, and warns that backups cannot be undone", async () => {
    expect((await planRemoval("backups", root, project)).consequences.join(" ")).toContain("cannot be undone");
    expect((await planRemoval("records", root, project)).consequences.join(" ")).toContain("backups for this project are kept");
    expect((await planRemoval("all", root, project)).consequences.join(" ")).toContain("EVERY project");
  });
  it("planning deletes nothing, and removal deletes exactly the plan", async () => {
    const plan = await planRemoval("cache", root, project);
    expect((await readdir(root)).includes("docs-cache")).toBe(true);
    const result = await executeRemoval(plan, root);
    expect(result.failed).toEqual([]);
    expect((await readdir(root)).includes("docs-cache")).toBe(false);
    expect((await readdir(project)).sort()).toEqual(["backups", "events.jsonl", "tasks.json"]);
    expect((await executeRemoval(plan, root)).failed).toEqual([]);
  });
  it("removing records keeps the backups, and removing backups keeps the records", async () => {
    await executeRemoval(await planRemoval("records", root, project), root);
    expect(await readdir(project)).toEqual(["backups"]);
    await mkdir(path.join(project, "backups"), { recursive: true });
    await writeFile(path.join(project, "tasks.json"), "[]");
    await executeRemoval(await planRemoval("backups", root, project), root);
    expect(await readdir(project)).toEqual(["tasks.json"]);
  });
  it("refuses a target outside the data folder, or the folder itself", async () => {
    const outside = path.join(base, "outside.txt");
    await writeFile(outside, "keep me");
    const result = await executeRemoval({ scope: "cache", targets: [outside, root, path.join(root, "..", "outside.txt")], consequences: [], stats: { files: 0, bytes: 0, newestMs: 0, truncated: false } }, root);
    expect(result.removed).toEqual([]);
    expect(result.failed).toHaveLength(3);
    expect(await readFile(outside, "utf8")).toBe("keep me");
    expect((await readdir(root)).length).toBeGreaterThan(0);
  });
  it("knows what is strictly inside", () => {
    expect(isStrictlyInside("/a/b", "/a/b/c")).toBe(true);
    for (const t of ["/a/b", "/a", "/a/bc", "/a/b/../c", "/x"]) expect(isStrictlyInside("/a/b", t), t).toBe(false);
  });
  it("formats sizes", () => {
    expect([5, 2048, 3 * 1024 * 1024].map(formatBytes)).toEqual(["5 B", "2.0 KB", "3.0 MB"]);
  });
});

describe("the lifecycle commands and hook", () => {
  let base = "";
  let project = "";
  let offline = false;
  let netCalls = 0;
  let manifestVersion: string | undefined = PACKAGE_VERSION;
  const out: string[] = [];
  const errs: string[] = [];
  const net: NetDeps = {
    resolve: async () => {
      netCalls += 1;
      return ["93.184.216.34"];
    },
    fetch: async () => {
      netCalls += 1;
      if (manifestVersion === undefined) throw new Error("boom");
      return new Response(JSON.stringify({ name: "jpe", version: manifestVersion }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
  const dataRoot = (): string => path.join(base, "data");
  const makeCtx = (over: Partial<CliContext> = {}): CliContext =>
    createContext({
      cwd: project,
      out: (t) => void out.push(t),
      err: (t) => void errs.push(t),
      net,
      pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: dataRoot(), PATH: "", ...(offline ? { JPE_OFFLINE: "1" } : {}) }, homedir: base },
      git: async () => ({ exitCode: 128, stdout: "" }),
      now: () => new Date(T0),
      terminal: () => ({ isTTY: false, columns: undefined, rows: undefined }),
      ...over,
    });
  const run = (...argv: string[]): Promise<number> => runCli(argv, makeCtx());
  const json = async <T,>(...argv: string[]): Promise<T> => {
    out.length = 0;
    expect(await run(...argv, "--json")).toBe(0);
    return JSON.parse(out.join("\n")) as T;
  };

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "jpe-lifecmd-"));
    project = path.join(base, "proj");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "package.json"), "{}");
    offline = false;
    netCalls = 0;
    manifestVersion = PACKAGE_VERSION;
    out.length = 0;
    errs.length = 0;
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("`jpe about` reports the version and where things live, without touching the network", async () => {
    const facts = await json<{ version: string; dataRoot: string; settingsFiles: Array<{ exists: boolean }>; check?: unknown }>("about");
    expect(facts.version).toBe(PACKAGE_VERSION);
    expect(facts.dataRoot).toBe(dataRoot());
    expect(facts.settingsFiles.every((s) => !s.exists)).toBe(true);
    expect(facts.check).toBeUndefined();
    expect(netCalls).toBe(0);
    expect(await run("about", "--width", "100")).toBe(0);
    expect(out.join("\n")).toContain("claude plugin update");
    expect(out.join("\n")).toContain("--keep-data");
  });

  it("--check reports up to date, update available, ahead, and failure, each for what it is", async () => {
    expect((await json<{ check: { state: string } }>("about", "--check")).check.state).toBe("up-to-date");
    manifestVersion = "999.0.0";
    expect((await json<{ check: { state: string; latest: string } }>("about", "--check")).check).toMatchObject({ state: "update-available", latest: "999.0.0" });
    manifestVersion = "0.0.1";
    expect((await json<{ check: { state: string } }>("about", "--check")).check.state).toBe("ahead");
    manifestVersion = undefined;
    expect((await json<{ check: { state: string } }>("about", "--check")).check.state).toBe("unknown");
    expect(await run("about", "--check")).toBe(0);
  });

  it("--check makes no network call in offline mode, and says so", async () => {
    offline = true;
    const facts = await json<{ check: { state: string; reason: string } }>("about", "--check");
    expect(facts.check.state).toBe("skipped");
    expect(facts.check.reason).toContain("Offline mode is on");
    expect(netCalls).toBe(0);
  });

  it("`jpe data` lists what is stored", async () => {
    await run("task", "add", "something");
    const inv = await json<Inventory>("data");
    expect(inv.root).toBe(dataRoot());
    expect(inv.projects.find((p) => p.current)?.records.files).toBeGreaterThan(0);
    expect(await run("data", "--width", "100")).toBe(0);
    expect(out.join("\n")).toContain("What JPE stores");
  });

  it("`jpe data remove` shows a preview and deletes nothing without --confirm", async () => {
    await run("task", "add", "keep me");
    out.length = 0;
    expect(await run("data", "remove", "records", "--width", "100")).toBe(0);
    expect(out.join("\n")).toContain("Nothing has been deleted");
    const tasks = path.join(makeCtx().stateDir(), "tasks.json");
    expect(await readFile(tasks, "utf8")).toContain("keep me");
  });

  it("--confirm deletes, wherever it appears in the command", async () => {
    await run("task", "add", "gone");
    expect(await run("data", "--confirm", "remove", "records")).toBe(0);
    expect(await readFile(path.join(makeCtx().stateDir(), "tasks.json"), "utf8").catch(() => "missing")).toBe("missing");
    await run("task", "add", "gone again");
    expect(await run("data", "remove", "records", "--confirm")).toBe(0);
  });

  it("removing something already empty says so and succeeds", async () => {
    expect(await run("data", "remove", "cache", "--confirm", "--width", "100")).toBe(0);
    expect(out.join("\n")).toContain("already empty");
  });

  it("`all` removes JPE's own data but leaves the project and other files alone", async () => {
    await run("task", "add", "x");
    await run("settings", "preset", "low-motion", "--apply");
    await writeFile(path.join(dataRoot(), "someone-elses.txt"), "keep");
    expect(await run("data", "remove", "all", "--confirm")).toBe(0);
    expect((await readdir(dataRoot())).sort()).toEqual(["someone-elses.txt"]);
    expect(await readFile(path.join(project, "package.json"), "utf8")).toBe("{}");
  });

  it("refuses an unknown scope or sub-command and deletes nothing", async () => {
    await run("task", "add", "safe");
    expect(await run("data", "remove", "everything", "--confirm")).not.toBe(0);
    expect(await run("data", "remove")).not.toBe(0);
    expect(await run("data", "erase")).not.toBe(0);
    expect(await readFile(path.join(makeCtx().stateDir(), "tasks.json"), "utf8")).toContain("safe");
  });

  it("--json describes a preview and a result", async () => {
    await run("task", "add", "z");
    const preview = await json<{ confirmed: boolean; targets: string[]; result?: unknown }>("data", "remove", "records");
    expect(preview).toMatchObject({ confirmed: false });
    expect(preview.result).toBeUndefined();
    const done = await json<{ confirmed: boolean; result: { removed: string[]; failed: unknown[] } }>("data", "remove", "records", "--confirm");
    expect(done.confirmed).toBe(true);
    expect(done.result.failed).toEqual([]);
    expect(done.result.removed.length).toBeGreaterThan(0);
  });

  describe("the update notice at session start", () => {
    const start = (source: string, id: string) => parsePayload("SessionStart", JSON.stringify({ session_id: id, cwd: project, hook_event_name: "SessionStart", source }));
    it("says nothing about versions on the very first run, but records it", async () => {
      const result = await onSessionStart(start("startup", "s1"), makeCtx());
      expect(result?.systemMessage).not.toContain("updated from");
      expect(await readSeenVersion(makeCtx())).toBe(PACKAGE_VERSION);
    });
    it("announces an update once, then is quiet", async () => {
      await recordSeenVersion(makeCtx(), "0.0.1");
      const first = await onSessionStart(start("startup", "s2"), makeCtx());
      expect(first?.systemMessage).toContain(`JPE was updated from 0.0.1 to ${PACKAGE_VERSION}`);
      expect(await readSeenVersion(makeCtx())).toBe(PACKAGE_VERSION);
      const second = await onSessionStart(start("startup", "s3"), makeCtx());
      expect(second?.systemMessage ?? "").not.toContain("updated from");
    });
    it("does not announce on clear, compact or resume", async () => {
      await recordSeenVersion(makeCtx(), "0.0.1");
      for (const source of ["clear", "compact", "resume"]) expect((await onSessionStart(start(source, `s-${source}`), makeCtx()))?.systemMessage ?? "").not.toContain("updated from");
      expect(await readSeenVersion(makeCtx())).toBe("0.0.1");
    });
    it("a damaged version record counts as never seen, not as an update", async () => {
      await mkdir(dataRoot(), { recursive: true });
      await writeFile(path.join(dataRoot(), "version.json"), "{ not json");
      expect(await readSeenVersion(makeCtx())).toBeUndefined();
      expect((await onSessionStart(start("startup", "s4"), makeCtx()))?.systemMessage ?? "").not.toContain("updated from");
    });
  });
});

describe("the approval rule for deleting data", () => {
  it.each([
    "node /x/dist/cli.js data remove all --confirm",
    "jpe data remove backups --confirm",
    'node "C:\\p\\dist\\cli.js" data --confirm remove cache',
    "jpe data remove records --width 100 --confirm",
  ])("asks first for: %s", (command) => {
    expect(assessCommand(command).level).not.toBe("safe");
  });
  it.each(["jpe data", "node /x/dist/cli.js data remove all", "jpe data remove cache --width 100", "jpe task add remove --confirm the thing", "jpe about --check"])("does not interrupt: %s", (command) => {
    expect(assessCommand(command).level).toBe("safe");
  });
  it("every scope is covered by the rule", () => {
    for (const scope of REMOVAL_SCOPES) expect(assessCommand(`jpe data remove ${scope} --confirm`).level).not.toBe("safe");
  });
});

describe("the lifecycle screens", () => {
  const stats = (files: number) => ({ files, bytes: files * 100, newestMs: T0, truncated: false });
  const inv: Inventory = { root: "/a/very/long/path/to/the/data/folder/that/is/long", settings: stats(2), docsCache: stats(0), other: stats(1), total: stats(5), projects: [{ key: "abcdef123456", current: true, records: stats(2), backups: stats(0) }] };
  it.each([20, 40, 60, 80, 120, 200])("never overflow at %i columns", (width) => {
    const p = profile(width);
    const plan = { scope: "all" as const, targets: ["/x"], consequences: ["Everything is removed and this is a long sentence that has to wrap."], stats: stats(3) };
    const lines = [
      ...aboutView({ version: "1.9.0", manifestVersion: "1.8.0", pluginRoot: "/some/long/plugin/folder/path", dataRoot: inv.root, settingsFiles: [{ label: "Your settings", path: "/a/very/long/path/config.json", exists: false }], pluginId: "jpe@jpe-marketplace", check: { state: "update-available", installed: "1.9.0", latest: "2.0.0" } }, p),
      ...dataView(inv, new Date(T0 + 60_000), p),
      ...removalView(plan, inv.root, undefined, p),
      ...removalView(plan, inv.root, { removed: ["/x"], failed: [{ target: "/y", reason: "locked" }] }, p),
    ];
    for (const line of lines) expect(lineWidth(line), String(width)).toBeLessThanOrEqual(width);
  });
  it("warns when the build and manifest disagree, and shows each update outcome", () => {
    const base = { version: "1.9.0", dataRoot: "/d", settingsFiles: [] };
    expect(text(aboutView({ ...base, manifestVersion: "1.8.0" }, profile(100)))).toContain("out of date");
    const outcomes: Array<[Parameters<typeof aboutView>[0]["check"], string]> = [
      [{ state: "up-to-date", installed: "1.9.0", latest: "1.9.0" }, "latest published version"],
      [{ state: "update-available", installed: "1.9.0", latest: "2.0.0" }, "newer version is published: 2.0.0"],
      [{ state: "ahead", installed: "1.9.0", latest: "1.0.0" }, "development build"],
      [{ state: "unknown", installed: "1.9.0", reason: "no route" }, "Could not tell"],
      [{ state: "skipped", reason: "Offline mode is on" }, "Did not check"],
    ];
    for (const [check, expected] of outcomes) expect(text(aboutView({ ...base, ...(check === undefined ? {} : { check }) }, profile(100))), expected).toContain(expected);
  });
  it("uses a default project key shape the CLI really produces", () => {
    expect(projectKey("/some/project")).toMatch(/^[0-9a-f]{12}$/);
  });
});

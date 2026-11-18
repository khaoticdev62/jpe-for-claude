import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";
import { collectHud } from "../../src/center/hud.js";
import { parseHud } from "../../src/center/hud-data.js";
import type { HudData } from "../../src/center/hud-data.js";
import { hudLines } from "../../src/center/home.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { listSessions, parseSessionState, type SessionSummary } from "../../src/hooks/state.js";
import { loadTasks, saveTasks, TASKS_FILE } from "../../src/tasks/store.js";
import { addTask, cleanTaskText, completeTask, findTask, MAX_TASKS, MAX_TASK_CHARS, openTasks, parseTasks, removeTask, serializeTasks, type Task } from "../../src/tasks/tasks.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { lineWidth } from "../../src/ui/doc.js";
import { resolveProfile } from "../../src/ui/profile.js";
import { resumeView, sessionsView, SHOWN_SESSIONS, tasksView } from "../../src/workspace/views.js";

const T0 = Date.UTC(2026, 2, 4, 12, 0, 0);
const NOW = new Date(T0 + 60_000);
const at = (ms: number): string => new Date(T0 + ms).toISOString();
const task = (over: Partial<Task> = {}): Task => ({ id: "aaaa1111", text: "Do the thing", createdAt: at(0), ...over });
const profile = (width: number) => resolveProfile(detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false, columns: width, rows: 40 }), defaultConfig().ui);
/** True when the text holds a control character, or a bidirectional override or isolate. */
const hasControl = (text: string): boolean => Array.from(text).some((ch) => {
  const code = ch.codePointAt(0) ?? 0;
  return (code <= 0x1f && code !== 0x0a) || (code >= 0x7f && code <= 0x9f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
});
const flat = (lines: ReadonlyArray<ReadonlyArray<{ text: string }>>): string => lines.map((l) => l.map((s) => s.text).join("")).join("\n");

describe("cleanTaskText", () => {
  it("makes text one safe line", () => {
    expect(cleanTaskText("  fix \n the\t bug  ")).toBe("fix the bug");
  });
  it("replaces control characters and bidirectional overrides", () => {
    const esc = String.fromCharCode(27);
    expect(hasControl(cleanTaskText(`a${esc}[31mb‮c⁦de`))).toBe(false);
  });
  it("cuts to the limit and keeps emoji and other scripts", () => {
    expect(cleanTaskText("x".repeat(500))).toHaveLength(MAX_TASK_CHARS);
    expect(cleanTaskText("שלום 🙂 日本語")).toBe("שלום 🙂 日本語");
  });
});

describe("parseTasks", () => {
  it("round-trips", () => {
    const list = [task(), task({ id: "bbbb2222", doneAt: at(5000) })];
    expect(parseTasks(serializeTasks(list))).toEqual(list);
  });
  it.each([["not JSON", "{nope"], ["an object", "{}"], ["null", "null"], ["a number", "7"], ["empty", ""]])("reads %s as no tasks", (_n, text) => {
    expect(parseTasks(text)).toEqual([]);
  });
  it("drops unreadable entries and keeps the good ones", () => {
    const bad = [null, 5, "x", {}, { ...task(), id: "no" }, { ...task(), id: "has space1" }, { ...task(), text: "   " }, { ...task(), text: 7 }, { ...task(), createdAt: "yesterday" }, { ...task(), doneAt: "soon" }];
    expect(parseTasks(JSON.stringify([task(), ...bad, task({ id: "cccc3333" })])).map((t) => t.id)).toEqual(["aaaa1111", "cccc3333"]);
  });
  it("cleans stored text again, so a hand-edited file cannot inject control characters", () => {
    const [t] = parseTasks(JSON.stringify([{ ...task(), text: "a\u0007b\nc" }]));
    expect(t?.text).toBe("a b c");
  });
});

describe("changing the list", () => {
  it("adds a task with clean text, and refuses empty text", () => {
    const added = addTask([], { id: "dddd4444", text: "  hello \n world ", at: NOW });
    expect(added?.task).toMatchObject({ id: "dddd4444", text: "hello world" });
    expect(addTask([], { id: "dddd4444", text: "  \n ", at: NOW })).toBeUndefined();
  });
  it("makes room by dropping the oldest finished task, never an open one", () => {
    const full = Array.from({ length: MAX_TASKS }, (_, i) => task({ id: `id${String(i).padStart(6, "0")}`, ...(i === 3 ? { doneAt: at(1) } : {}) }));
    const added = addTask(full, { id: "newtask1", text: "new", at: NOW });
    expect(added?.tasks).toHaveLength(MAX_TASKS);
    expect(added?.tasks.some((t) => t.id === "id000003")).toBe(false);
    expect(added?.tasks.at(-1)?.id).toBe("newtask1");
  });
  it("refuses to add when every task is still open", () => {
    const full = Array.from({ length: MAX_TASKS }, (_, i) => task({ id: `id${String(i).padStart(6, "0")}` }));
    expect(addTask(full, { id: "newtask1", text: "new", at: NOW })).toBeUndefined();
  });
  const list = [task({ id: "aaaa1111", text: "one" }), task({ id: "bbbb2222", text: "two", doneAt: at(1) }), task({ id: "cccc3333", text: "three" }), task({ id: "cccc4444", text: "four" })];
  it("finds by position in the open list", () => {
    expect(findTask(list, "1")?.text).toBe("one");
    expect(findTask(list, "2")?.text).toBe("three");
    expect(findTask(list, "3")?.text).toBe("four");
    expect(findTask(list, "4")).toBeUndefined();
    expect(findTask(list, "0")).toBeUndefined();
  });
  it("finds by id start, but only when it is long enough and unambiguous", () => {
    expect(findTask(list, "aaaa")?.text).toBe("one");
    expect(findTask(list, "bbbb")?.text).toBe("two");
    expect(findTask(list, "cccc")).toBeUndefined();
    expect(findTask(list, "cccc3")?.text).toBe("three");
    expect(findTask(list, "aaa")).toBeUndefined();
    expect(findTask(list, "zzzz")).toBeUndefined();
  });
  it("completes an open task only, and only once", () => {
    const done = completeTask(list, "1", NOW);
    expect(done?.task.doneAt).toBe(NOW.toISOString());
    expect(openTasks(done?.tasks ?? [])).toHaveLength(2);
    expect(completeTask(list, "bbbb", NOW)).toBeUndefined();
  });
  it("removes a task and leaves the rest alone", () => {
    expect(removeTask(list, "2")?.tasks.map((t) => t.id)).toEqual(["aaaa1111", "bbbb2222", "cccc4444"]);
    expect(removeTask(list, "nope")).toBeUndefined();
  });
});

describe("the task views", () => {
  const list = [task({ id: "aaaa1111", text: "Fix the login bug" }), task({ id: "bbbb2222", text: "Old thing", doneAt: at(1000) })];
  it("shows an empty list with how to add", () => {
    expect(flat(tasksView([], NOW, profile(100)))).toContain("jpe task add");
  });
  it("shows open tasks numbered, hides finished ones unless asked, and says so", () => {
    const hidden = flat(tasksView(list, NOW, profile(100)));
    expect(hidden).toContain("1 open task");
    expect(hidden).toContain("Fix the login bug");
    expect(hidden).not.toContain("Old thing");
    expect(hidden).toContain("--all");
    expect(flat(tasksView(list, NOW, profile(100), true))).toContain("Old thing");
  });
  it("cannot be broken by a hostile task", () => {
    const esc = String.fromCharCode(27);
    const out = flat(tasksView([task({ text: `${esc}[31mred${esc}]0;title text` })], NOW, profile(60)));
    expect(hasControl(out)).toBe(false);
    expect(out).toContain("text");
  });
  it.each([20, 40, 60, 80, 120, 200])("never overflows at %i columns", (width) => {
    const many = Array.from({ length: 12 }, (_, i) => task({ id: `id${String(i).padStart(6, "0")}`, text: `A fairly long task description number ${i} that needs wrapping`, ...(i % 3 === 0 ? { doneAt: at(2000) } : {}) }));
    for (const line of [...tasksView(many, NOW, profile(width), true), ...sessionsView([{ id: "abcdef123456", startedAt: at(0), filesEdited: 3, backups: 2 }], NOW, profile(width))]) expect(lineWidth(line)).toBeLessThanOrEqual(width);
  });
  it("lists sessions, limits them and says what is not known", () => {
    expect(flat(sessionsView([], NOW, profile(100)))).toContain("No sessions are recorded");
    const many: SessionSummary[] = Array.from({ length: SHOWN_SESSIONS + 2 }, (_, i) => ({ id: `s${i}abcdefgh`, startedAt: at(-i * 1000), filesEdited: i, backups: 0 }));
    const out = flat(sessionsView(many, NOW, profile(100)));
    expect(out).toContain("2 older sessions are not shown");
    expect(out).toContain("does not know what a session was about");
  });
});

describe("the resume view", () => {
  const hud = { hudVersion: 1, generatedAt: at(0), project: { name: "proj", ecosystems: [] }, git: { state: "not-repo" }, verification: { status: "NOT_TESTED", reasons: [], checksAvailable: [] }, languageServersMissing: [], runtime: { offline: false, approval: "risk-based" }, openTasks: 3 } as unknown as HudData;
  it("says there is no earlier session when none is recorded", () => {
    expect(flat(resumeView(hud, [], [], NOW, profile(100)))).toContain("No earlier session is recorded");
  });
  it("describes the last session by what was seen, and lists open tasks once", () => {
    const out = flat(resumeView(hud, [{ id: "abc", startedAt: at(-3_600_000), filesEdited: 4, backups: 2 }], [task({ text: "Ship it" })], NOW, profile(100)));
    expect(out).toContain("Claude edited 4 files and JPE backed up 2");
    expect(out).toContain("1. Ship it");
    expect(out.match(/Tasks/g)).toBeNull();
  });
});

describe("what the command center shows", () => {
  const base = { hudVersion: 1, generatedAt: at(0), project: { name: "p", ecosystems: [] }, git: { state: "not-repo" }, verification: { status: "NOT_TESTED", reasons: [], checksAvailable: [] }, languageServersMissing: [], runtime: { offline: false, approval: "risk-based" } };
  it("reads a valid open-task count and refuses a malformed one", () => {
    expect(parseHud({ ...base, openTasks: 2 })?.openTasks).toBe(2);
    expect(parseHud(base)?.openTasks).toBeUndefined();
    for (const bad of [0, -1, 1.5, "2", null]) expect(parseHud({ ...base, openTasks: bad }), String(bad)).toBeUndefined();
  });
  it("shows a Tasks row only when there are open tasks", () => {
    const text = (n?: number): string => flat(hudLines({ ...(base as unknown as HudData), ...(n === undefined ? {} : { openTasks: n }) }, profile(100), NOW));
    expect(text()).not.toContain("Tasks");
    expect(text(0)).not.toContain("Tasks");
    expect(text(3)).toContain("3 open");
  });
});

describe("saved sessions, records and commands", () => {
  let base = "";
  let project = "";
  let tick = 0;
  let idn = 0;
  const out: string[] = [];
  const errs: string[] = [];
  const makeCtx = (): CliContext =>
    createContext({
      cwd: project,
      out: (t) => void out.push(t),
      err: (t) => void errs.push(t),
      pathEnv: { platform: "linux", env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), PATH: "" }, homedir: base },
      git: async () => ({ exitCode: 128, stdout: "" }),
      newId: () => `id${String(++idn).padStart(6, "0")}`,
      now: () => new Date(T0 + ++tick * 1000),
      terminal: () => ({ isTTY: false, columns: undefined, rows: undefined }),
    });
  const writeSession = async (name: string, text: string): Promise<void> => {
    const dir = path.join(makeCtx().stateDir(), "sessions");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${name}.json`), text);
  };
  const state = (startedAt: string, edits: Record<string, string> = {}) => JSON.stringify({ startedAt, promptNudged: false, stopNudged: false, edits, backups: {}, checked: {}, diagnosticsRuns: 0 });

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "jpe-ws-"));
    project = path.join(base, "proj");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "package.json"), "{}");
    out.length = 0;
    errs.length = 0;
    tick = 0;
    idn = 0;
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("parseSessionState refuses anything that is not a valid state", () => {
    expect(parseSessionState(state(at(0)))?.startedAt).toBe(at(0));
    for (const bad of ["{nope", "[]", "{}", JSON.stringify({ startedAt: "yesterday" })]) expect(parseSessionState(bad), bad).toBeUndefined();
  });

  it("lists sessions newest first, counts edits, and skips damaged files", async () => {
    await writeSession("older", state(at(0)));
    await writeSession("newer", state(at(5000), { "a.ts": at(1), "b.ts": at(2) }));
    await writeSession("broken", "{ not json");
    const list = await listSessions(makeCtx());
    expect(list.map((s) => s.id)).toEqual(["newer", "older"]);
    expect(list[0]).toMatchObject({ filesEdited: 2, backups: 0 });
  });

  it("no sessions folder reads as no sessions", async () => {
    expect(await listSessions(makeCtx())).toEqual([]);
  });

  it("the store round-trips and a damaged file reads as no tasks", async () => {
    const ctx = makeCtx();
    expect(await loadTasks(ctx)).toEqual([]);
    await saveTasks(ctx, [task()]);
    expect(await loadTasks(ctx)).toEqual([task()]);
    await writeFile(path.join(ctx.stateDir(), TASKS_FILE), "\u0000garbage");
    expect(await loadTasks(ctx)).toEqual([]);
  });

  it("`jpe task` adds, lists, finishes and removes, with the same facts in --json", async () => {
    expect(await runCli(["task", "add", "Fix", "the", "login", "bug"], makeCtx())).toBe(0);
    expect(await runCli(["task", "add", "Write release notes"], makeCtx())).toBe(0);
    out.length = 0;
    expect(await runCli(["task", "list", "--json"], makeCtx())).toBe(0);
    expect(JSON.parse(out.join("\n")).map((t: Task) => t.text)).toEqual(["Fix the login bug", "Write release notes"]);
    out.length = 0;
    expect(await runCli(["task", "done", "1", "--json"], makeCtx())).toBe(0);
    expect(JSON.parse(out.join("\n"))).toMatchObject({ text: "Fix the login bug" });
    out.length = 0;
    await runCli(["task", "list", "--json"], makeCtx());
    expect(JSON.parse(out.join("\n")).map((t: Task) => t.text)).toEqual(["Write release notes"]);
    out.length = 0;
    await runCli(["task", "list", "--all", "--json"], makeCtx());
    expect(JSON.parse(out.join("\n"))).toHaveLength(2);
    expect(await runCli(["task", "remove", "1"], makeCtx())).toBe(0);
    out.length = 0;
    await runCli(["task", "list", "--all", "--json"], makeCtx());
    expect(JSON.parse(out.join("\n")).map((t: Task) => t.text)).toEqual(["Fix the login bug"]);
  });

  it("a task with shell characters is stored as plain text", async () => {
    const hostile = '"; rm -rf / # $(whoami) `id`';
    await runCli(["task", "add", hostile], makeCtx());
    expect((await loadTasks(makeCtx()))[0]?.text).toBe(hostile);
  });

  it("refuses empty text, an unknown task, and an unknown sub-command, changing nothing", async () => {
    expect(await runCli(["task", "add"], makeCtx())).not.toBe(0);
    expect(await runCli(["task", "done", "9"], makeCtx())).not.toBe(0);
    expect(await runCli(["task", "remove", "zzzz"], makeCtx())).not.toBe(0);
    expect(await runCli(["task", "frobnicate"], makeCtx())).not.toBe(0);
    expect(await loadTasks(makeCtx())).toEqual([]);
    expect(errs.join("\n")).toContain("Usage: jpe task");
  });

  it("`jpe sessions` shows recorded sessions and `--json` has the same facts", async () => {
    await writeSession("s1", state(at(0), { "a.ts": at(1) }));
    expect(await runCli(["sessions", "--width", "100"], makeCtx())).toBe(0);
    expect(out.join("\n")).toContain("Recent sessions");
    out.length = 0;
    await runCli(["sessions", "--json"], makeCtx());
    expect(JSON.parse(out.join("\n"))[0]).toMatchObject({ id: "s1", filesEdited: 1 });
  });

  it("`jpe resume` gathers the project facts, last session and open tasks", async () => {
    await writeSession("s1", state(at(0), { "a.ts": at(1) }));
    await runCli(["task", "add", "Ship it"], makeCtx());
    out.length = 0;
    expect(await runCli(["resume", "--width", "100"], makeCtx())).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Where you left off");
    expect(text).toContain("Claude edited 1 file");
    expect(text).toContain("Ship it");
    out.length = 0;
    await runCli(["resume", "--json"], makeCtx());
    const json = JSON.parse(out.join("\n"));
    expect(json.lastSession).toMatchObject({ id: "s1" });
    expect(json.openTasks).toHaveLength(1);
  });

  it("collectHud counts open tasks, and shows none when there are none", async () => {
    expect((await collectHud(makeCtx())).openTasks).toBeUndefined();
    await runCli(["task", "add", "One"], makeCtx());
    await runCli(["task", "add", "Two"], makeCtx());
    await runCli(["task", "done", "1"], makeCtx());
    expect((await collectHud(makeCtx())).openTasks).toBe(1);
  });
});

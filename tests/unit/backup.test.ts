import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackupStore } from "../../src/recovery/backup.js";

let base = "";
let project = "";
let store: BackupStore;
let counter = 0;
let clock = 0;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "jpe-bak-"));
  project = path.join(base, "project");
  await mkdir(project);
  counter = 0;
  clock = 0;
  store = new BackupStore({
    dir: path.join(base, "backups"),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)),
    newId: () => `bk${++counter}`,
  });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const write = (rel: string, text: string) => writeFile(path.join(project, rel), text);
const read = (rel: string) => readFile(path.join(project, rel), "utf8");

describe("BackupStore", () => {
  it("restores modified files, removes files created by the change, and verifies cleanly", async () => {
    await write("a.txt", "original");
    const b = await store.create(project, ["a.txt", "new.txt", "a.txt"], "before edit");
    expect(b.files.map((f) => [f.path, f.existed])).toEqual([["a.txt", true], ["new.txt", false]]);

    await write("a.txt", "changed");
    await write("new.txt", "created by change");
    await store.seal(b.id);

    expect(await store.verify(b.id)).toEqual({ ok: true, problems: [] });
    const r = await store.rollback(b.id);
    expect(r.restored).toEqual(["a.txt"]);
    expect(r.removed).toEqual(["new.txt"]);
    expect(await read("a.txt")).toBe("original");
    await expect(read("new.txt")).rejects.toThrow();
  });

  it("refuses to overwrite work done after the change, unless forced, and keeps a safety copy when forced", async () => {
    await write("a.txt", "original");
    const b = await store.create(project, ["a.txt"], "x");
    await write("a.txt", "claude edit");
    await store.seal(b.id);
    await write("a.txt", "user edit made later");

    const blocked = await store.rollback(b.id);
    expect(blocked.conflicts).toEqual(["a.txt"]);
    expect(await read("a.txt")).toBe("user edit made later");

    const forced = await store.rollback(b.id, { force: true });
    expect(forced.restored).toEqual(["a.txt"]);
    expect(await read("a.txt")).toBe("original");
    expect(forced.safetyBackupId).toBeDefined();
    // The forced rollback is itself undoable.
    await store.rollback(forced.safetyBackupId as string, { force: true });
    expect(await read("a.txt")).toBe("user edit made later");
  });

  it("detects a tampered or missing stored copy and will not restore it", async () => {
    await write("a.txt", "original");
    const b = await store.create(project, ["a.txt"], "x");
    await write("a.txt", "changed");
    await writeFile(path.join(base, "backups", b.id, "files", "0"), "tampered");
    expect((await store.verify(b.id)).ok).toBe(false);
    const r = await store.rollback(b.id);
    expect(r.restored).toEqual([]);
    expect(r.problems[0]).toContain("damaged");
    expect(await read("a.txt")).toBe("changed");
  });

  it("refuses credentials files and paths outside the project", async () => {
    await write(".env", "TOKEN=abc");
    await expect(store.create(project, [".env"], "x")).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await expect(store.create(project, ["../outside.txt"], "x")).rejects.toMatchObject({ code: "PATH_REJECTED" });
  });

  it("rejects invalid or unknown backup ids", async () => {
    await expect(store.rollback("../../etc")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.rollback("nope")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("lists newest first and prunes only the oldest beyond the keep count", async () => {
    await write("a.txt", "1");
    await store.create(project, ["a.txt"], "one");
    await store.create(project, ["a.txt"], "two");
    await store.create(project, ["a.txt"], "three");
    expect((await store.list()).map((m) => m.label)).toEqual(["three", "two", "one"]);
    expect(await store.prune(2)).toEqual(["bk1"]);
    expect((await store.list()).map((m) => m.id)).toEqual(["bk3", "bk2"]);
  });

  it("does nothing when files are already in the backed-up state", async () => {
    await write("a.txt", "same");
    const b = await store.create(project, ["a.txt"], "x");
    await store.seal(b.id);
    const r = await store.rollback(b.id);
    expect(r).toEqual({ restored: [], removed: [], conflicts: [], problems: [] });
  });
});

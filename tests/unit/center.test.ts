import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, type CliContext } from "../../src/cli/context.js";
import { CENTER_COMMANDS, COMMAND_GROUPS, findCommand } from "../../src/center/commands.js";
import { fuzzyMatch } from "../../src/center/fuzzy.js";
import { actionLines, buildHome, buildPaletteText, formatAge, homeActions, hudLines, MAX_NUMBERED } from "../../src/center/home.js";
import { collectHud, type HudData } from "../../src/center/hud.js";
import { clearHistory, EMPTY_MEMORY, MAX_FAVORITES, MAX_HISTORY, parseMemory, recentIds, recordUse, toggleFavorite, type CenterMemory } from "../../src/center/memory.js";
import { parseQuery, rankCommands, resolveSubmit } from "../../src/center/palette.js";
import { notifications, suggest } from "../../src/center/suggestions.js";
import { EvidenceLedger } from "../../src/core/ledger.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { type Line, lineText, lineWidth } from "../../src/ui/doc.js";
import { resolveProfile, type RenderProfile, type UiSettings } from "../../src/ui/profile.js";
import { defaultConfig } from "../../src/config/defaults.js";

const ROOT = path.resolve(__dirname, "../..");
const NOW = new Date("2026-03-04T12:00:00.000Z");

function profile(width = 80, settings: Partial<UiSettings> = {}): RenderProfile {
  const caps = detectCapabilities({ env: { LANG: "en_US.UTF-8", COLORTERM: "truecolor" }, platform: "linux", isTTY: true, columns: width, rows: 40 });
  return resolveProfile(caps, { ...defaultConfig().ui, ...settings });
}

const baseHud = (over: Partial<HudData> = {}): HudData => ({
  hudVersion: 1,
  generatedAt: NOW.toISOString(),
  project: { name: "demo", ecosystems: ["node"], packageManager: "npm" },
  git: { state: "clean", branch: "main" },
  verification: { status: "VERIFIED", at: "2026-03-04T11:50:00.000Z", reasons: [], checksAvailable: ["typecheck", "unit-test"] },
  languageServersMissing: [],
  runtime: { offline: false, approval: "risk-based" },
  ...over,
});
const verification = (over: Partial<HudData["verification"]>): HudData["verification"] => ({ ...baseHud().verification, ...over });
const text = (lines: readonly Line[]): string => lines.map(lineText).join("\n");

describe("the command registry", () => {
  it("lists exactly the skills in skills/, so a command cannot be added or renamed in only one place", async () => {
    const folders = (await readdir(path.join(ROOT, "skills"))).filter((f) => f !== "jpe").sort();
    expect(CENTER_COMMANDS.map((c) => c.id).sort()).toEqual(folders);
  });

  it("marks a command as changing things exactly when its skill cannot be started by Claude on its own", async () => {
    for (const command of CENTER_COMMANDS) {
      const body = await readFile(path.join(ROOT, "skills", command.id, "SKILL.md"), "utf8");
      const frontMatter = body.split(/^---\s*$/m)[1] ?? "";
      expect(/^disable-model-invocation:\s*true\s*$/m.test(frontMatter), command.id).toBe(command.changesThings);
    }
  });

  it("has unique ids, a slash command per id, a known group and non-empty text", () => {
    expect(new Set(CENTER_COMMANDS.map((c) => c.id)).size).toBe(CENTER_COMMANDS.length);
    for (const c of CENTER_COMMANDS) {
      expect(c.slash).toBe(`jpe:${c.id}`);
      expect(COMMAND_GROUPS).toContain(c.group);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(20);
      expect(c.keywords.length).toBeGreaterThan(0);
    }
    expect(findCommand("verify")?.slash).toBe("jpe:verify");
    expect(findCommand("nope")).toBeUndefined();
  });
});

describe("fuzzyMatch", () => {
  it("needs every query character, in order, ignoring case", () => {
    expect(fuzzyMatch("vrf", "Verify")?.indices).toEqual([0, 2, 4]);
    expect(fuzzyMatch("VER", "verify")?.indices).toEqual([0, 1, 2]);
    expect(fuzzyMatch("fv", "verify")).toBeUndefined();
    expect(fuzzyMatch("xyz", "verify")).toBeUndefined();
    expect(fuzzyMatch("verifyy", "verify")).toBeUndefined();
  });
  it("matches everything for an empty or blank query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch("   ", "anything")).toEqual({ score: 0, indices: [] });
  });
  it("scores a prefix above a scattered match, and a word start above the middle of a word", () => {
    const prefix = fuzzyMatch("ver", "verify")?.score ?? 0;
    const scattered = fuzzyMatch("ver", "a very long version")?.score ?? 0;
    expect(prefix).toBeGreaterThan(scattered);
    const wordStart = fuzzyMatch("lm", "long method")?.score ?? 0;
    const middle = fuzzyMatch("lm", "plumber")?.score ?? 0;
    expect(wordStart).toBeGreaterThan(middle);
  });
  it("scores consecutive letters above separated ones", () => {
    expect(fuzzyMatch("ab", "xxabxx")?.score ?? 0).toBeGreaterThan(fuzzyMatch("ab", "xaxxbx")?.score ?? 0);
  });
  it("finds the best occurrence, not just the first", () => {
    expect(fuzzyMatch("fix", "prefix fix")?.indices).toEqual([7, 8, 9]);
  });
  it("never throws and always returns in-range positions", () => {
    for (const q of ["", "a", "é", "日本", "👨‍👩‍👧", "   x   ", "\u0000", "a".repeat(200)]) {
      for (const t of ["", "abc", "日本語", "👨‍👩‍👧 family", "é"]) {
        const m = fuzzyMatch(q, t);
        for (const i of m?.indices ?? []) {
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(t.length);
        }
      }
    }
  });
});

describe("memory", () => {
  it("starts empty and reads back what it wrote", () => {
    const m = recordUse(toggleFavorite(EMPTY_MEMORY, "fix"), "verify", "2026-03-04T10:00:00.000Z");
    expect(parseMemory(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
  it("is tolerant of damaged or foreign stored values: it keeps what is valid and never throws", () => {
    const junk: unknown[] = [undefined, null, 42, "text", [], [1, 2], { favorites: "x" }, { history: 5 }, { favorites: [1, null, {}] }, { history: [null, 1, {}, { id: 5 }, { id: "verify" }, { id: "verify", at: "not a date" }] }];
    for (const value of junk) expect(parseMemory(value)).toEqual(EMPTY_MEMORY);
    const mixed = parseMemory({ favorites: ["fix", "bogus", "fix", 3, "verify"], history: [{ id: "verify", at: "2026-03-04T10:00:00.000Z" }, { id: "bogus", at: "2026-03-04T10:00:00.000Z" }, { id: "fix", at: "nope" }] });
    expect(mixed.favorites).toEqual(["fix", "verify"]);
    expect(mixed.history).toEqual([{ id: "verify", at: "2026-03-04T10:00:00.000Z" }]);
  });
  it("is capped, so it cannot grow without bound", () => {
    let m: CenterMemory = EMPTY_MEMORY;
    for (let i = 0; i < MAX_HISTORY + 30; i++) m = recordUse(m, "verify", new Date(NOW.getTime() + i).toISOString());
    expect(m.history).toHaveLength(MAX_HISTORY);
    const oversized = parseMemory({ favorites: Array.from({ length: 100 }, () => "fix"), history: Array.from({ length: 500 }, () => ({ id: "fix", at: NOW.toISOString() })) });
    expect(oversized.favorites.length).toBeLessThanOrEqual(MAX_FAVORITES);
    expect(oversized.history).toHaveLength(MAX_HISTORY);
  });
  it("records newest first, ignores unknown commands, and does not modify what it is given", () => {
    const first = recordUse(EMPTY_MEMORY, "verify", "2026-03-04T10:00:00.000Z");
    const second = recordUse(first, "fix", "2026-03-04T11:00:00.000Z");
    expect(second.history.map((h) => h.id)).toEqual(["fix", "verify"]);
    expect(first.history).toHaveLength(1);
    expect(EMPTY_MEMORY.history).toHaveLength(0);
    expect(recordUse(second, "bogus", NOW.toISOString())).toBe(second);
    expect(toggleFavorite(second, "bogus")).toBe(second);
  });
  it("toggles favourites on and off", () => {
    const on = toggleFavorite(EMPTY_MEMORY, "audit");
    expect(on.favorites).toEqual(["audit"]);
    expect(toggleFavorite(on, "audit").favorites).toEqual([]);
  });
  it("lists distinct recent commands newest first, and clearing history keeps favourites", () => {
    let m = toggleFavorite(EMPTY_MEMORY, "audit");
    for (const id of ["verify", "fix", "verify", "status"]) m = recordUse(m, id, NOW.toISOString());
    expect(recentIds(m, 10)).toEqual(["status", "verify", "fix"]);
    expect(recentIds(m, 2)).toEqual(["status", "verify"]);
    expect(clearHistory(m)).toEqual({ ...m, history: [] });
  });
});

describe("parseQuery", () => {
  it.each([
    ["", { kind: "search", text: "" }],
    ["verify", { kind: "search", text: "verify" }],
    ["  ver  ", { kind: "search", text: "ver" }],
    ["3", { kind: "jump", index: 2 }],
    ["12", { kind: "jump", index: 11 }],
    ["0", { kind: "search", text: "0" }],
    ["100", { kind: "search", text: "100" }],
    ["explain src/app.ts", { kind: "run", commandId: "explain", args: "src/app.ts" }],
    ["/jpe:explain src/app.ts", { kind: "run", commandId: "explain", args: "src/app.ts" }],
    ["/jpe explain  what is this ", { kind: "run", commandId: "explain", args: "what is this" }],
    ["JPE Research zod", { kind: "run", commandId: "research", args: "zod" }],
    ["/jpe:verify", { kind: "search", text: "verify" }],
    ["unknowncmd something", { kind: "search", text: "unknowncmd something" }],
  ])("%j", (input, expected) => {
    expect(parseQuery(input)).toEqual(expected);
  });
  it("caps argument length", () => {
    const parsed = parseQuery(`explain ${"x".repeat(5000)}`);
    expect(parsed.kind === "run" && parsed.args.length).toBe(500);
  });
});

describe("rankCommands", () => {
  const rank = (q: string, m: CenterMemory = EMPTY_MEMORY): string[] => rankCommands(q, m).map((e) => e.command.id);

  it("puts the obvious command first for a prefix, an abbreviation, and a keyword", () => {
    expect(rank("ver")[0]).toBe("verify");
    expect(rank("vrfy")[0]).toBe("verify");
    expect(rank("repair")[0]).toBe("fix");
    expect(rank("docs")[0]).toBe("research");
    expect(rank("security")[0]).toBe("audit");
    expect(rank("settings")[0]).toBe("config");
    expect(rank("/jpe:imp")[0]).toBe("impact");
  });
  it("returns nothing when nothing matches", () => {
    expect(rank("qqqqzzzz")).toEqual([]);
  });
  it("orders an empty query favourites first, then recent, then the rest in registry order", () => {
    let m = toggleFavorite(EMPTY_MEMORY, "config");
    m = recordUse(recordUse(m, "audit", "2026-03-04T10:00:00.000Z"), "learn", "2026-03-04T11:00:00.000Z");
    const order = rank("", m);
    expect(order.slice(0, 3)).toEqual(["config", "learn", "audit"]);
    expect(order).toHaveLength(CENTER_COMMANDS.length);
    expect(new Set(order).size).toBe(order.length);
    expect(order.slice(3)).toEqual(CENTER_COMMANDS.map((c) => c.id).filter((id) => !["config", "learn", "audit"].includes(id)));
  });
  it("keeps the list as shown while a number is typed", () => {
    expect(rank("3")).toEqual(rank(""));
  });
  it("adds a fixed bonus for a favourite (4) and a decaying one for recent commands (3, then 2.5, ...)", () => {
    const score = (q: string, m: CenterMemory, id: string): number => rankCommands(q, m).find((e) => e.command.id === id)?.score ?? Number.NaN;
    const plain = score("e", EMPTY_MEMORY, "learn");
    expect(score("e", toggleFavorite(EMPTY_MEMORY, "learn"), "learn") - plain).toBeCloseTo(4, 10);
    const recent = recordUse(recordUse(EMPTY_MEMORY, "learn", "2026-03-04T10:00:00.000Z"), "audit", "2026-03-04T11:00:00.000Z");
    expect(score("e", recent, "audit") - score("e", EMPTY_MEMORY, "audit")).toBeCloseTo(3, 10);
    expect(score("e", recent, "learn") - plain).toBeCloseTo(2.5, 10);
  });
  it("lets a favourite overtake an otherwise equal match", () => {
    // "ing" matches the keyword "failing" of Fix and the word "teaching"-style text elsewhere; whichever is first, a favourite wins a tie.
    const base = rank("check");
    const favourite = base[base.length - 1] ?? "";
    expect(rank("check", toggleFavorite(EMPTY_MEMORY, favourite)).indexOf(favourite)).toBeLessThanOrEqual(base.indexOf(favourite));
  });
  it("marks favourites and last-used times, and highlights the matched title letters", () => {
    const m = recordUse(toggleFavorite(EMPTY_MEMORY, "verify"), "verify", "2026-03-04T10:00:00.000Z");
    const first = rankCommands("ver", m)[0];
    expect(first?.command.id).toBe("verify");
    expect(first?.isFavorite).toBe(true);
    expect(first?.lastUsed).toBe("2026-03-04T10:00:00.000Z");
    expect(first?.titleMatch).toEqual([0, 1, 2]);
    expect(rankCommands("ver", EMPTY_MEMORY)[0]?.lastUsed).toBeUndefined();
  });
  it("lists the typed command first when a command and arguments were typed", () => {
    expect(rank("learn closures")[0]).toBe("learn");
  });
  it("never throws, never repeats a command, and only returns real commands, whatever is typed", () => {
    for (const q of ["", " ", "\u0000", "é", "日本語", "👨‍👩‍👧", "'; DROP TABLE", "<b>", "../..", "a".repeat(1000), "999999999999", "-1", "NaN", "/", "//jpe:", "jpe:", "jpe "]) {
      const ids = rank(q);
      expect(new Set(ids).size, JSON.stringify(q)).toBe(ids.length);
      for (const id of ids) expect(findCommand(id)).toBeDefined();
    }
  });
});

describe("resolveSubmit", () => {
  const entries = rankCommands("", EMPTY_MEMORY);
  it("launches a typed command with its arguments", () => {
    expect(resolveSubmit("explain src/app.ts", entries)).toEqual({ ok: true, commandId: "explain", args: "src/app.ts" });
  });
  it("launches the numbered item, matching the numbers shown", () => {
    for (const [i, entry] of entries.entries()) expect(resolveSubmit(String(i + 1), entries)).toEqual({ ok: true, commandId: entry.command.id, args: "" });
  });
  it("explains an item number that does not exist", () => {
    expect(resolveSubmit("42", entries)).toEqual({ ok: false, message: "There is no item 42 in the list." });
  });
  it("launches the best match for plain text, and says so when there is none", () => {
    expect(resolveSubmit("ver", rankCommands("ver", EMPTY_MEMORY))).toEqual({ ok: true, commandId: "verify", args: "" });
    expect(resolveSubmit("qqqzzz", [])).toEqual({ ok: false, message: 'No command matches "qqqzzz".' });
  });
});

describe("suggest and notifications", () => {
  it("suggests nothing when everything is verified and clean", () => {
    expect(suggest(baseHud())).toEqual([]);
    expect(notifications(baseHud())).toEqual([]);
  });
  it("suggests Fix, confirmed, with the recorded reason, when the last verification FAILED", () => {
    const hud = baseHud({ verification: verification({ status: "FAILED", reasons: ["unit-test failed with exit code 1."] }) });
    const [first] = suggest(hud);
    expect(first).toMatchObject({ commandId: "fix", basis: "confirmed", level: "error", id: "verification-failed" });
    expect(first?.why).toContain("unit-test failed with exit code 1.");
  });
  it("points BLOCKED, PARTIALLY_VERIFIED and FUNCTIONAL_WITH_WARNINGS at Status, with their own words", () => {
    for (const status of ["BLOCKED", "PARTIALLY_VERIFIED", "FUNCTIONAL_WITH_WARNINGS"] as const) {
      const s = suggest(baseHud({ verification: verification({ status, reasons: ["because."] }) }))[0];
      expect(s?.commandId, status).toBe("status");
      expect(s?.why, status).toContain(status);
    }
  });
  it("asks for a first verification only when checks exist, and is confirmed because nothing was run", () => {
    const { at: _at, ...unverified } = verification({ status: "NOT_TESTED", reasons: [], checksAvailable: ["typecheck", "lint"] });
    const withChecks = baseHud({ verification: unverified });
    expect(suggest(withChecks)[0]).toMatchObject({ commandId: "verify", basis: "confirmed", level: "info" });
    expect(suggest(withChecks)[0]?.why).toContain("typecheck, lint");
    const noChecks = baseHud({ verification: verification({ status: "NOT_TESTED", reasons: [], checksAvailable: [] }) });
    expect(suggest(noChecks)).toEqual([]);
  });
  it("reports a damaged verification record rather than hiding it", () => {
    const hud = baseHud({ verification: verification({ status: "NOT_TESTED", problem: "The saved verification record is damaged." }) });
    expect(suggest(hud)[0]).toMatchObject({ id: "verification-record-damaged", basis: "confirmed", level: "warning" });
  });
  it("suggests Setup for missing language servers, naming them", () => {
    const s = suggest(baseHud({ languageServersMissing: ["TypeScript (typescript-language-server)"] }));
    expect(s[0]).toMatchObject({ commandId: "setup", basis: "confirmed", level: "warning" });
    expect(s[0]?.why).toContain("typescript-language-server");
  });
  it("labels the uncommitted-changes advice as a suggestion, not a finding, and never raises it as a notification", () => {
    const hud = baseHud({ git: { state: "dirty", branch: "main", changedFiles: 3 } });
    const s = suggest(hud);
    expect(s[0]).toMatchObject({ id: "uncommitted-changes", basis: "suggestion", level: "info" });
    expect(s[0]?.why).toContain("a habit, not a finding");
    expect(s[0]?.why).toContain("3 uncommitted files");
    expect(notifications(hud)).toEqual([]);
    expect(suggest(baseHud({ git: { state: "dirty", branch: "main", changedFiles: 1 } }))[0]?.why).toContain("1 uncommitted file.");
  });
  it("does not add the commit advice on top of a failure or an existing verify suggestion", () => {
    const failed = suggest(baseHud({ git: { state: "dirty", branch: "m", changedFiles: 2 }, verification: verification({ status: "FAILED", reasons: [] }) }));
    expect(failed.map((s) => s.id)).toEqual(["verification-failed"]);
    const unverified = suggest(baseHud({ git: { state: "dirty", branch: "m", changedFiles: 2 }, verification: verification({ status: "NOT_TESTED", reasons: [] }) }));
    expect(unverified.map((s) => s.id)).toEqual(["verification-not-run"]);
  });
  it("orders by urgency, then confirmed before suggestion", () => {
    const hud = baseHud({ languageServersMissing: ["Go (gopls)"], verification: verification({ status: "FAILED", reasons: [] }) });
    expect(suggest(hud).map((s) => s.level)).toEqual(["error", "warning"]);
  });
  it("raises notifications only for confirmed warnings and errors, with stable ids", () => {
    const hud = baseHud({ languageServersMissing: ["Go (gopls)"], verification: verification({ status: "FAILED", reasons: [] }), git: { state: "dirty", branch: "m", changedFiles: 2 } });
    expect(notifications(hud).map((n) => n.id)).toEqual(["verification-failed", "language-servers-missing"]);
    expect(notifications(hud).map((n) => n.id)).toEqual(notifications(hud).map((n) => n.id));
  });
});

describe("formatAge", () => {
  it.each([
    ["2026-03-04T12:00:00.000Z", "just now"],
    ["2026-03-04T11:59:30.000Z", "just now"],
    ["2026-03-04T11:59:00.000Z", "1 minute ago"],
    ["2026-03-04T11:50:00.000Z", "10 minutes ago"],
    ["2026-03-04T11:00:00.000Z", "1 hour ago"],
    ["2026-03-04T05:00:00.000Z", "7 hours ago"],
    ["2026-03-03T12:00:00.000Z", "1 day ago"],
    ["2026-02-02T12:00:00.000Z", "30 days ago"],
    ["2099-01-01T00:00:00.000Z", "just now"],
    ["garbage", "at an unknown time"],
  ])("%s is %s", (iso, expected) => {
    expect(formatAge(iso, NOW)).toBe(expected);
  });
});

describe("homeActions", () => {
  it("numbers items from 1 with no gaps, uses each command once, and never exceeds nine", () => {
    const hud = baseHud({ verification: verification({ status: "FAILED", reasons: ["x."] }), languageServersMissing: ["Go (gopls)"] });
    let m = toggleFavorite(EMPTY_MEMORY, "audit");
    m = recordUse(m, "learn", NOW.toISOString());
    const actions = homeActions(hud, m);
    expect(actions.map((a) => a.n)).toEqual(actions.map((_, i) => i + 1));
    expect(actions.length).toBeLessThanOrEqual(MAX_NUMBERED);
    expect(new Set(actions.map((a) => a.commandId)).size).toBe(actions.length);
  });
  it("orders next steps, then favourites, then recent, then the remaining commands", () => {
    const hud = baseHud({ verification: verification({ status: "FAILED", reasons: [] }) });
    let m = toggleFavorite(EMPTY_MEMORY, "audit");
    m = recordUse(m, "learn", NOW.toISOString());
    const tags = homeActions(hud, m).map((a) => a.tag);
    expect(tags.slice(0, 3)).toEqual(["next", "favorite", "recent"]);
    expect(tags.slice(3).every((t) => t === "command")).toBe(true);
  });
  it("carries what the screen needs: the slash command, whether it asks first, and the evidence", () => {
    const [fix] = homeActions(baseHud({ verification: verification({ status: "FAILED", reasons: ["boom."] }) }), EMPTY_MEMORY);
    expect(fix).toMatchObject({ commandId: "fix", slash: "/jpe:fix", changesThings: true, basis: "confirmed", level: "error", args: "" });
    expect(fix?.detail).toContain("boom.");
    const verify = homeActions(baseHud(), EMPTY_MEMORY).find((a) => a.commandId === "verify");
    expect(verify).toMatchObject({ changesThings: false, tag: "command" });
  });
  it("shows all commands when there is nothing to suggest", () => {
    expect(homeActions(baseHud(), EMPTY_MEMORY).map((a) => a.commandId)).toEqual(CENTER_COMMANDS.slice(0, MAX_NUMBERED).map((c) => c.id));
  });
});

describe("the home screen", () => {
  const WIDTHS = [20, 30, 40, 60, 80, 120];
  const SETTINGS: Array<[string, Partial<UiSettings>]> = [["unicode", {}], ["ascii", { unicode: "off" }], ["screen reader", { screenReader: true }], ["compact", { density: "compact" }]];
  const failing = baseHud({ verification: verification({ status: "FAILED", reasons: ["unit-test failed with exit code 1.", "lint passed."] }), git: { state: "dirty", branch: "feature/a-rather-long-branch-name", changedFiles: 12 }, languageServersMissing: ["TypeScript (typescript-language-server)", "Python (pyright)"], project: { name: "a-project-with-a-long-name-日本語", ecosystems: ["node", "python"], packageManager: "pnpm" } });

  it("never exceeds the width at any size, in any display mode", () => {
    for (const width of WIDTHS) {
      for (const [name, settings] of SETTINGS) {
        for (const hud of [baseHud(), failing]) {
          for (const line of buildHome(hud, EMPTY_MEMORY, profile(width, settings), NOW)) {
            expect(lineWidth(line), `${name} @${width}: ${lineText(line)}`).toBeLessThanOrEqual(width);
          }
        }
      }
    }
  });
  it("shows the real status word, the age, the reasons and the evidence for the first step", () => {
    const out = text(buildHome(failing, EMPTY_MEMORY, profile(100), NOW));
    expect(out).toContain("FAILED");
    expect(out).toContain("last run 10 minutes ago");
    expect(out).toContain("unit-test failed with exit code 1.");
    expect(out).toContain("1. /jpe:fix\n   asks first · next step\n   Fix the failing checks.");
    expect(out).toContain("(confirmed)");
    expect(out).toContain("12 uncommitted files");
    expect(out).toContain("missing: TypeScript (typescript-language-server), Python (pyright)");
  });
  it("says 'never run' rather than inventing a time, and shows NOT_TESTED", () => {
    const { at: _at, ...neverRun } = verification({ status: "NOT_TESTED", reasons: ["No verification has been run for this project yet."] });
    const out = text(buildHome(baseHud({ verification: neverRun }), EMPTY_MEMORY, profile(100), NOW));
    expect(out).toContain("NOT_TESTED");
    expect(out).not.toContain("last run");
  });
  it("describes each git state in words", () => {
    const say = (git: HudData["git"]): string => text(hudLines(baseHud({ git }), profile(100), NOW));
    expect(say({ state: "unavailable" })).toContain("git is not installed");
    expect(say({ state: "not-repo" })).toContain("not a git repository");
    expect(say({ state: "clean", branch: "main" })).toContain("branch main, no uncommitted changes");
    expect(say({ state: "dirty", branch: "main", changedFiles: 1 })).toContain("1 uncommitted file");
  });
  it("says when it is offline and which approval mode is on", () => {
    const out = text(hudLines(baseHud({ runtime: { offline: true, approval: "always" } }), profile(100), NOW));
    expect(out).toContain("offline (documentation from the cache only)");
    expect(out).toContain("approvals: always");
  });
  it("reports a damaged verification record in words", () => {
    const out = text(hudLines(baseHud({ verification: verification({ status: "NOT_TESTED", reasons: [], problem: "The saved verification record is damaged. Run /jpe:verify again to replace it." }) }), profile(100), NOW));
    expect(out).toContain("damaged");
  });
  it("lists the commands without a number key under 'Also available'", () => {
    const out = text(buildHome(baseHud(), EMPTY_MEMORY, profile(100), NOW));
    expect(out).toContain("Also available");
    expect(out).toContain("/jpe:config");
  });
  it("gives a screen reader plain words and no borders", () => {
    const out = text(buildHome(failing, EMPTY_MEMORY, profile(80, { screenReader: true }), NOW));
    expect(out).toContain("Status: FAILED");
    expect(out).not.toMatch(/[✘▲✔│─╭]/);
  });
  it("numbers in the text match the numbers the pane's keys use", () => {
    const actions = homeActions(failing, EMPTY_MEMORY);
    const out = text(actionLines(actions, profile(100)));
    for (const a of actions) expect(out).toContain(`${a.n}. ${a.slash}`);
  });
  it("sanitises a project name that tries to inject escape sequences", () => {
    const out = text(hudLines(baseHud({ project: { name: "evil\u001b[2J\u001b]0;x\u0007name", ecosystems: ["node"] } }), profile(100), NOW));
    expect(out).toContain("evilname");
    expect(out).not.toContain("\u001b");
  });
});

describe("the palette as text", () => {
  it("numbers results the way Enter and the number keys resolve them", () => {
    const m = toggleFavorite(EMPTY_MEMORY, "audit");
    const out = text(buildPaletteText("", m, profile(100)));
    const entries = rankCommands("", m);
    for (const [i, e] of entries.entries()) expect(out).toContain(`${i + 1} │ /${e.command.slash}`);
    expect(out).toContain("/jpe:audit ★");
  });
  it("uses an ASCII marker without Unicode, and says plainly when nothing matches", () => {
    expect(text(buildPaletteText("", toggleFavorite(EMPTY_MEMORY, "audit"), profile(100, { unicode: "off" })))).toContain("/jpe:audit *");
    expect(text(buildPaletteText("qqqzzz", EMPTY_MEMORY, profile(100)))).toContain('No command matches "qqqzzz".');
  });
  it("never exceeds the width", () => {
    for (const width of [20, 40, 80]) for (const line of buildPaletteText("e", EMPTY_MEMORY, profile(width))) expect(lineWidth(line)).toBeLessThanOrEqual(width);
  });
});

describe("collectHud (real files, real evidence)", () => {
  let base = "";
  let project = "";
  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "jpe-hud-"));
    project = path.join(base, "my-project");
    await mkdir(project);
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const ctxFor = (over: Partial<CliContext> = {}): CliContext =>
    createContext({
      cwd: project,
      pathEnv: { platform: process.platform, env: { CLAUDE_PLUGIN_DATA: path.join(base, "data"), PATH: "" }, homedir: base },
      git: async () => ({ exitCode: 128, stdout: "" }),
      now: () => NOW,
      ...over,
    });

  it("reads the project, and says NOT_TESTED with the checks that exist when nothing has been verified", async () => {
    await writeFile(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "vitest run", build: "tsup" } }));
    const hud = await collectHud(ctxFor());
    expect(hud).toMatchObject({ hudVersion: 1, generatedAt: NOW.toISOString(), project: { name: "my-project", ecosystems: ["node"] }, git: { state: "not-repo" }, runtime: { offline: false, approval: "risk-based" } });
    expect(hud.verification.status).toBe("NOT_TESTED");
    expect(hud.verification.at).toBeUndefined();
    expect(hud.verification.checksAvailable).toEqual(expect.arrayContaining(["unit-test", "build"]));
  });

  it("derives the status from the saved evidence, not from a stored label", async () => {
    await writeFile(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    const ctx = ctxFor();
    let n = 0;
    const ledger = new EvidenceLedger({ now: () => NOW, newId: () => `e${++n}` });
    ledger.recordCommand({ check: "unit-test", command: "npm test", exitCode: 1, durationMs: 5, output: "1 failed" });
    await ctx.writeText(path.join(ctx.stateDir(), "ledger.jsonl"), ledger.toJsonLines());
    await ctx.writeText(path.join(ctx.stateDir(), "run.json"), JSON.stringify({ at: "2026-03-04T11:55:00.000Z", required: ["unit-test"] }));
    const hud = await collectHud(ctx);
    expect(hud.verification).toMatchObject({ status: "FAILED", at: "2026-03-04T11:55:00.000Z" });
    expect(hud.verification.reasons.join(" ")).toContain("unit-test");

    // The same run with a passing result is VERIFIED: the label is recomputed from the evidence each time.
    const passing = new EvidenceLedger({ now: () => NOW, newId: () => `p${++n}` });
    passing.recordCommand({ check: "unit-test", command: "npm test", exitCode: 0, durationMs: 5 });
    await ctx.writeText(path.join(ctx.stateDir(), "ledger.jsonl"), passing.toJsonLines());
    expect((await collectHud(ctx)).verification.status).toBe("VERIFIED");
  });

  it("reports a damaged record as a problem and NOT_TESTED, never as a guess", async () => {
    const ctx = ctxFor();
    await ctx.writeText(path.join(ctx.stateDir(), "ledger.jsonl"), "this is not json");
    await ctx.writeText(path.join(ctx.stateDir(), "run.json"), "{ also not json");
    const hud = await collectHud(ctx);
    expect(hud.verification.status).toBe("NOT_TESTED");
    expect(hud.verification.problem).toMatch(/damaged/);
  });

  it("reads git state: clean and dirty", async () => {
    const gitWith = (porcelain: string) => async (args: readonly string[]) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true\n" };
      if (args[0] === "symbolic-ref") return { exitCode: 0, stdout: "main\n" };
      return { exitCode: 0, stdout: porcelain };
    };
    expect((await collectHud(ctxFor({ git: gitWith("") }))).git).toEqual({ state: "clean", branch: "main" });
    const dirty = (await collectHud(ctxFor({ git: gitWith(" M a.ts\0?? b.ts\0") }))).git;
    expect(dirty).toMatchObject({ state: "dirty", branch: "main", changedFiles: 2 });
  });

  it("copes with git being unavailable, and with an empty folder", async () => {
    const hud = await collectHud(ctxFor({ git: async () => { throw new Error("spawn git ENOENT"); } }));
    expect(hud.git).toEqual({ state: "unavailable" });
    expect(hud.project.ecosystems).toEqual([]);
  });

  it("reads the offline and approval settings", async () => {
    await mkdir(path.join(base, "data"), { recursive: true });
    await writeFile(path.join(base, "data", "config.json"), JSON.stringify({ schemaVersion: 1, runtime: { offline: true }, engineering: { approval: "always" } }));
    expect((await collectHud(ctxFor())).runtime).toEqual({ offline: true, approval: "always" });
  });

  it("changes nothing on disk", async () => {
    await writeFile(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
    await collectHud(ctxFor());
    expect((await readdir(project)).sort()).toEqual(["package.json"]);
  });
});

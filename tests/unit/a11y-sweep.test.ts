import { describe, expect, it } from "vitest";
import { agentsView } from "../../src/agents/views.js";
import { buildMetrics, buildRuns } from "../../src/agents/runs.js";
import type { AgentEvent } from "../../src/agents/log.js";
import { hudLines } from "../../src/center/home.js";
import type { HudData } from "../../src/center/hud-data.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { describeSettings, PRESETS } from "../../src/config/catalog.js";
import type { SessionSummary } from "../../src/hooks/state.js";
import type { Inventory } from "../../src/lifecycle/inventory.js";
import { aboutView, dataView, removalView } from "../../src/lifecycle/views.js";
import type { LogEntry } from "../../src/obs/log.js";
import { logView, offlineView } from "../../src/obs/views.js";
import { presetListView, presetPreviewView, settingDetailView, settingsView, type SettingRow } from "../../src/settings/views.js";
import type { Task } from "../../src/tasks/tasks.js";
import { detectCapabilities } from "../../src/ui/capabilities.js";
import { lineWidth, type Line } from "../../src/ui/doc.js";
import { paint } from "../../src/ui/paint.js";
import { type RenderProfile, resolveProfile } from "../../src/ui/profile.js";
import { resumeView, sessionsView, tasksView } from "../../src/workspace/views.js";

/**
 * Every screen, in every way a person can ask for it to be drawn. These are the promises of the accessibility settings:
 * with Unicode off a screen is plain ASCII, and in screen-reader mode it has no borders, rules or symbols, so a screen reader
 * reads words instead of line-drawing characters. The sample data is plain ASCII, so any other character comes from JPE.
 */

const T0 = Date.UTC(2026, 2, 4, 12, 0, 0);
const NOW = new Date(T0 + 90_000);
const at = (ms: number): string => new Date(T0 + ms).toISOString();

const MODES = [
  { name: "unicode", unicode: "on", screenReader: false },
  { name: "ascii", unicode: "off", screenReader: false },
  { name: "screen reader", unicode: "on", screenReader: true },
  { name: "screen reader + ascii", unicode: "off", screenReader: true },
] as const;

const profileFor = (mode: (typeof MODES)[number], width: number): RenderProfile =>
  resolveProfile(detectCapabilities({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false, columns: width, rows: 40 }), { ...defaultConfig().ui, unicode: mode.unicode, screenReader: mode.screenReader });

const stats = (files: number) => ({ files, bytes: files * 100, newestMs: T0, truncated: false });
const inventory: Inventory = { root: "/data/jpe", settings: stats(2), docsCache: stats(3), other: stats(1), total: stats(9), projects: [{ key: "abcdef123456", current: true, records: stats(2), backups: stats(1) }, { key: "fedcba654321", current: false, records: stats(0), backups: stats(0) }] };
const events: AgentEvent[] = [
  { at: at(0), kind: "start", agentId: "agent-0001", agentType: "Explore", sessionId: "s1" },
  { at: at(12_000), kind: "stop", agentId: "agent-0001", agentType: "Explore", sessionId: "s1" },
  { at: at(30_000), kind: "start", agentId: "agent-0002", agentType: "Plan", sessionId: "s1" },
];
const runs = buildRuns(events, NOW);
const tasks: Task[] = [{ id: "aaaa1111", text: "Fix the login bug", createdAt: at(0) }, { id: "bbbb2222", text: "Old finished task", createdAt: at(0), doneAt: at(5000) }];
const sessions: SessionSummary[] = [{ id: "session-abcdef", startedAt: at(-3_600_000), filesEdited: 4, backups: 2 }];
const logEntries: LogEntry[] = [{ at: at(0), level: "error", source: "hook:PreToolUse", message: "failed, so JPE added nothing to this step: INVALID_CONFIG: not valid JSON" }, { at: at(1000), level: "warn", source: "hook:Stop", message: "timed out" }];
const settingRows: SettingRow[] = describeSettings().map((s, i) => ({ ...s, value: s.default, source: i % 4 === 0 ? "global" : "default" }));
const hud = {
  hudVersion: 1,
  generatedAt: at(0),
  project: { name: "demo", ecosystems: ["node"], packageManager: "npm" },
  git: { state: "dirty", branch: "main", changedFiles: 3 },
  verification: { status: "FAILED", reasons: ["lint failed"], checksAvailable: ["lint"], at: at(0) },
  languageServersMissing: ["Go (gopls)"],
  runtime: { offline: true, approval: "risk-based" },
  review: { changedFiles: 3, state: "stale", decision: "approved", at: at(0) },
  agents: { running: 1, total: 2, noStopSeen: 0 },
  openTasks: 2,
} as unknown as HudData;

/** Every screen, built for a profile. */
const SCREENS: Array<[string, (p: RenderProfile) => Line[]]> = [
  ["agents", (p) => agentsView(runs, buildMetrics(runs), NOW, p)],
  ["agents (empty)", (p) => agentsView([], [], NOW, p)],
  ["tasks", (p) => tasksView(tasks, NOW, p, true)],
  ["tasks (empty)", (p) => tasksView([], NOW, p)],
  ["sessions", (p) => sessionsView(sessions, NOW, p)],
  ["resume", (p) => resumeView(hud, sessions, tasks, NOW, p)],
  ["home facts", (p) => hudLines(hud, p, NOW)],
  ["settings", (p) => settingsView(settingRows, p)],
  ["setting detail", (p) => settingDetailView(settingRows[0] as SettingRow, p)],
  ["presets", (p) => presetListView(PRESETS, p)],
  ["preset preview", (p) => presetPreviewView(PRESETS[0] ?? (undefined as never), [{ key: "ui.screenReader", from: false, to: true, toDefault: false }, { key: "ui.theme", from: "jpe-light", to: "jpe", toDefault: true }], true, true, "your settings", p)],
  ["offline", (p) => offlineView({ offline: true, source: "environment", cachedDocs: 2, providers: [{ name: "local-package", needsNetwork: false }, { name: "official", needsNetwork: true }] }, p)],
  ["offline (online)", (p) => offlineView({ offline: false, source: "default", cachedDocs: 0, providers: [{ name: "official", needsNetwork: true }] }, p)],
  ["log", (p) => logView(logEntries, NOW, "info", "info", 2, p, "The global configuration is not valid JSON.")],
  ["log (empty)", (p) => logView([], NOW, "info", "info", 0, p)],
  ["about", (p) => aboutView({ version: "1.10.0", manifestVersion: "1.9.0", pluginRoot: "/plugin", dataRoot: "/data", settingsFiles: [{ label: "Your settings", path: "/data/config.json", exists: true }], pluginId: "jpe@jpe-marketplace", check: { state: "update-available", installed: "1.10.0", latest: "2.0.0" } }, p)],
  ["about (skipped)", (p) => aboutView({ version: "1.10.0", dataRoot: "/data", settingsFiles: [], check: { state: "skipped", reason: "Offline mode is on" } }, p)],
  ["data", (p) => dataView(inventory, NOW, p)],
  ["removal preview", (p) => removalView({ scope: "all", targets: ["/x"], consequences: ["Everything is removed."], stats: stats(3) }, "/data", undefined, p)],
  ["removal result", (p) => removalView({ scope: "cache", targets: ["/x"], consequences: ["The cache is removed."], stats: stats(3) }, "/data", { removed: ["/x"], failed: [{ target: "/y", reason: "locked" }] }, p)],
];

const BOX_AND_SYMBOLS = /[←-➿⬀-⯿]/u;
const nonAscii = (text: string): string[] => Array.from(new Set(Array.from(text).filter((ch) => (ch.codePointAt(0) ?? 0) > 126)));
const plain = (lines: Line[], p: RenderProfile): string => paint(lines, { ...p, color: "none" });

describe("every screen honours the accessibility settings", () => {
  for (const mode of MODES) {
    for (const width of [40, 100]) {
      describe(`${mode.name} at ${width} columns`, () => {
        for (const [name, build] of SCREENS) {
          it(name, () => {
            const p = profileFor(mode, width);
            const lines = build(p);
            const text = plain(lines, p);
            expect(text.length).toBeGreaterThan(0);
            for (const line of lines) expect(lineWidth(line), "width").toBeLessThanOrEqual(width);
            if (mode.unicode === "off") expect(nonAscii(text), "non-ASCII characters in an ASCII screen").toEqual([]);
            if (mode.screenReader) expect(text.match(BOX_AND_SYMBOLS)?.[0] ?? "", "box or symbol glyph in a screen-reader screen").toBe("");
          });
        }
      });
    }
  }

  it("a screen-reader screen says each status in words", () => {
    const p = profileFor(MODES[2], 100);
    const text = plain(agentsView(runs, buildMetrics(runs), NOW, p), p).toLowerCase();
    expect(text).toMatch(/running|finished|recorded/);
    const home = plain(hudLines(hud, p, NOW), p);
    expect(home).toContain("FAILED");
  });
});

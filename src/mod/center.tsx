/**
 * JPE's command center inside Claude Code: a pane with the project's facts, numbered next steps and a command
 * palette, a status-bar summary, and the entry point for a bare `/jpe`.
 *
 * This file only draws and wires. What to show, what to suggest and how the palette ranks come from `src/center`
 * (pure, tested without Claude Code), and the facts come from the `jpe` command line, so nothing here can disagree
 * with the text the same screens print.
 *
 * Honesty rules: nothing is shown that was not read; a failed read or a failed command is reported as a failure; a
 * success message appears only after the command call returned; and a command that can change things is never run
 * without the person confirming it in the pane.
 */

import { atom, read, update } from "claude-code";
import type { EngineInterface, On, RenderEvent } from "claude-code";
import { findCommand } from "../center/commands.js";
import { actionBody, actionHead, buildHome, buildPaletteText, homeActions, hudLines, statusLineText } from "../center/home.js";
import { type HudData, parseHud } from "../center/hud-data.js";
import { type CenterMemory, EMPTY_MEMORY, parseMemory, recordUse, toggleFavorite } from "../center/memory.js";
import { parseQuery, rankCommands, resolveSubmit } from "../center/palette.js";
import { notifications } from "../center/suggestions.js";
import type { Capabilities } from "../ui/capabilities.js";
import { heading, textLines } from "../ui/components.js";
import type { Line } from "../ui/doc.js";
import { paint, resolveSpanStyle } from "../ui/paint.js";
import { DEFAULT_UI_SETTINGS, type RenderProfile, resolveProfile } from "../ui/profile.js";

const PANE = "jpe-center";
const MEMORY_KEY = "center-memory";
const HUD_TIMEOUT_MS = 20_000;
const MAX_TOAST_CHARS = 200;
const MIN_PANE_COLUMNS = 24;
/** A turn that ends right after another does not re-read the facts: they were just read. */
const MIN_REFRESH_GAP_MS = 5000;
const DEFAULT_COLUMNS = 80;

const hudState = atom({ plugin: "jpe", key: "hud" } as const, null as unknown, { shape: "hud-1" });
const queryState = atom({ plugin: "jpe", key: "query" } as const, "");
const pendingState = atom({ plugin: "jpe", key: "pending" } as const, null as { commandId: string; args: string } | null, { shape: "pending-1" });
const noticeState = atom({ plugin: "jpe", key: "notice" } as const, "");
const memoryState = atom({ plugin: "jpe", key: "memory" } as const, EMPTY_MEMORY as unknown, { shape: "memory-1" });

/** Notifications already shown this session, so the same finding does not toast again. */
const toasted = new Set<string>();
let refreshing: Promise<HudData | undefined> | undefined;
let lastRefreshAt = 0;

const capabilities = (columns: number, plain: boolean): Capabilities => ({
  color: plain ? "none" : "truecolor",
  styles: !plain,
  unicode: true,
  columns,
  rows: 30,
  interactive: !plain,
  remote: false,
  ci: false,
  reducedMotion: false,
  screenReader: false,
  reasons: [],
});

/** How to draw in a pane that JPE owns: its own dark surface, compact, true colour. */
const paneProfile = (columns: number): RenderProfile => resolveProfile(capabilities(columns, false), { ...DEFAULT_UI_SETTINGS, density: "compact" }, { surface: "own" });
/** How to draw into the transcript when no pane can be shown: plain text, no escape sequences. */
const textProfile = (columns: number): RenderProfile => resolveProfile(capabilities(columns, true), DEFAULT_UI_SETTINGS);

/** Starts background work whose failure must never surface as an unhandled rejection (the module can unload while it runs). */
const background = (work: Promise<unknown>): void => {
  work.catch(() => undefined);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200);

async function currentMemory($: EngineInterface): Promise<CenterMemory> {
  return parseMemory(await read($, memoryState));
}

async function changeMemory($: EngineInterface, change: (memory: CenterMemory) => CenterMemory): Promise<void> {
  await update($, memoryState, (value) => change(parseMemory(value)));
  await $.store.set(MEMORY_KEY, await currentMemory($));
}

async function say($: EngineInterface, text: string): Promise<void> {
  await update($, noticeState, () => text);
}

/** Reads the project facts from the JPE command line. Returns undefined, with the reason shown, if that fails. */
async function refreshHud($: EngineInterface): Promise<HudData | undefined> {
  if (refreshing !== undefined) return refreshing;
  refreshing = (async (): Promise<HudData | undefined> => {
    try {
      const result = await $.process.run(["node", `${$.plugin.root}/dist/cli.js`, "center", "hud", "--json"], { timeoutMs: HUD_TIMEOUT_MS });
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `the command exited with code ${result.exitCode}`);
      const data = parseHud(JSON.parse(result.stdout));
      if (data === undefined) throw new Error("the project facts were in a format this version of JPE does not understand");
      await update($, hudState, () => data);
      lastRefreshAt = Date.now();
      await update($, noticeState, (previous) => (previous.startsWith("Could not read") ? "" : previous));
      announce($, data);
      return data;
    } catch (error) {
      await say($, `Could not read this project's facts: ${messageOf(error)}. Run /jpe:setup to check JPE.`);
      return undefined;
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

/** Puts the status line up to date and toasts the most urgent finding that has not been shown yet. */
function announce($: EngineInterface, data: HudData): void {
  $.ui.status(statusLineText(data));
  const fresh = notifications(data).find((n) => !toasted.has(n.id));
  if (fresh === undefined) return;
  toasted.add(fresh.id);
  $.ui.toast(`${fresh.title}: ${fresh.why}`.slice(0, MAX_TOAST_CHARS));
}

/** Runs a JPE command as if the person typed it. Commands that can change things wait for confirmation first. */
async function launch($: EngineInterface, commandId: string, args: string, confirmed = false): Promise<void> {
  const command = findCommand(commandId);
  if (command === undefined) {
    await say($, `There is no JPE command called "${commandId}".`);
    return;
  }
  if (command.changesThings && !confirmed) {
    await update($, pendingState, () => ({ commandId, args }));
    await say($, "");
    return;
  }
  await update($, pendingState, () => null);
  try {
    await changeMemory($, (memory) => recordUse(memory, command.id, new Date(Date.now()).toISOString()));
    await $.command.run({ command: command.slash, args });
    await say($, `Ran /${command.slash}${args === "" ? "" : ` ${args}`}.`);
  } catch (error) {
    await say($, `Could not run /${command.slash}: ${messageOf(error)}`);
  }
}

async function submitQuery($: EngineInterface, raw: string): Promise<void> {
  const memory = await currentMemory($);
  const submission = resolveSubmit(raw, rankCommands(raw, memory));
  if (!submission.ok) {
    await say($, submission.message);
    return;
  }
  await update($, queryState, () => "");
  await launch($, submission.commandId, submission.args);
}

/** Records a command typed outside the pane (`/jpe:verify`, `/jpe verify`) in the history, so Recent is honest. */
async function recordTyped($: EngineInterface, command: string, args: string): Promise<void> {
  const id = command === "jpe:jpe" ? args.trim().split(/\s+/)[0]?.toLowerCase() : command.startsWith("jpe:") ? command.slice(4) : undefined;
  if (id === undefined || findCommand(id) === undefined) return;
  await changeMemory($, (memory) => recordUse(memory, id, new Date(Date.now()).toISOString()));
}

/** Opens the pane, or returns the home screen as text when no pane can be shown, so `/jpe` always shows something. */
async function openCenter($: EngineInterface, columns: number): Promise<{ text: string; isTextDisplayOnly: true }> {
  const data = await refreshHud($);
  const placed = await $.ui.open({ id: PANE, title: "JPE", focus: true, closeOnEscape: true });
  if (placed.isPlaced) {
    return { text: "JPE command center opened. Press 1 to 9 to pick an item, Tab to move, Enter to choose, Esc to close it.", isTextDisplayOnly: true };
  }
  const profile = textProfile(columns);
  const memory = await currentMemory($);
  if (data === undefined) {
    const reason = await read($, noticeState);
    return { text: paint([...heading("JPE command center", profile), ...textLines(reason === "" ? "Could not read this project's facts." : reason, columns), ...buildPaletteText("", memory, profile)], profile), isTextDisplayOnly: true };
  }
  return { text: paint(buildHome(data, memory, profile, new Date(Date.now())), profile), isTextDisplayOnly: true };
}

export function register(on: On): void {
  on("session.start", async ($, e, next) => {
    try {
      const stored = await $.store.get(MEMORY_KEY);
      await update($, memoryState, () => parseMemory(stored));
    } catch {
      // A store that cannot be read just means no favourites yet; the interface still works.
    }
    background(refreshHud($));
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    if (Date.now() - lastRefreshAt >= MIN_REFRESH_GAP_MS) background(refreshHud($));
    return next(e);
  });

  // This hook can answer a command instead of passing it on, so what happens if it throws matters. It must fail open:
  // the engine then skips the hook and runs the /jpe skill as before, which is the text menu. A `.catch` is for guards
  // that should refuse on failure, and this is not one. It also reads its input defensively, because an event without
  // `args` (a bare command raised by another plugin) must still reach the skill unchanged.
  on("command.run", async ($, e, next) => {
    const args = (e as { args?: string }).args ?? "";
    if (e.command === "jpe:jpe" && args.trim() === "") return openCenter($, (e as { presentation?: { columns: number } }).presentation?.columns ?? DEFAULT_COLUMNS);
    background(recordTyped($, e.command, args));
    return next({ ...e, args });
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e: RenderEvent) => {
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e);
    const columns = Math.max(MIN_PANE_COLUMNS, e.props.bodyColumns);
    const profile = paneProfile(columns);
    const colors = profile.theme.colors;

    const data = parseHud(await read($, hudState));
    const memory = parseMemory(await read($, memoryState));
    const query = await read($, queryState);
    const pending = await read($, pendingState);
    const notice = await read($, noticeState);

    const row = (line: Line): unknown => (
      <Box flexDirection="row">
        {line.map((part) => {
          const style = resolveSpanStyle(profile, part);
          return (
            <Text color={style.color ?? colors.text} bold={style.bold} dimColor={style.dim}>
              {part.text === "" ? " " : part.text}
            </Text>
          );
        })}
      </Box>
    );
    const rows = (lines: readonly Line[]): unknown[] => lines.map(row);

    const now = new Date(Date.now());
    const actions = data === undefined ? [] : homeActions(data, memory);
    const entries = rankCommands(query, memory);
    const top = entries[0];
    const parsed = parseQuery(query);

    const confirm = pending === null ? [] : [
      <Box flexDirection="column">
        {rows(textLines(`/${findCommand(pending.commandId)?.slash ?? pending.commandId}${pending.args === "" ? "" : ` ${pending.args}`} can change files, settings or installed software in this project. Run it?`, columns - 2, { role: "warning", bold: true }))}
        <Button key="confirm-run" hotkey="y" label="y  Yes, run it" onPress={() => background(launch($, pending.commandId, pending.args, true))} />
        <Button key="confirm-cancel" hotkey="n" label="n  Cancel" onPress={() => background(update($, pendingState, () => null))} />
      </Box>,
    ];

    return (
      <Box flexDirection="column" backgroundColor={profile.theme.background}>
        {rows(heading("JPE command center", profile))}
        {data === undefined ? rows(textLines(notice === "" ? "Reading this project's facts…" : notice, columns - 2, { role: "muted" })) : rows(hudLines(data, profile, now))}
        {rows(heading("What to do", profile))}
        {actions.map((a) => (
          <Box flexDirection="column">
            <Button key={`action-${a.n}`} hotkey={String(a.n)} label={`${actionHead(a).map((s) => s.text).join("")}`} onPress={() => background(launch($, a.commandId, a.args))} />
            {rows(actionBody(a, profile))}
          </Box>
        ))}
        {confirm}
        <Input key="palette" label="Command" placeholder="search, an item number, or a command and what to give it" value={query} onInput={(v: string) => background(update($, queryState, () => v))} onSubmit={(v: string) => background(submitQuery($, v))} />
        {query.trim() !== "" && entries.length > 0 ? (
          <Select
            key="results"
            label="Matches"
            value={top?.command.id}
            options={entries.slice(0, 9).map((entry, i) => ({ value: entry.command.id, label: `${i + 1}  /${entry.command.slash}${entry.isFavorite ? " ★" : ""}  ${entry.command.summary}` }))}
            onSelect={(id: string) => background(launch($, id, parsed.kind === "run" && parsed.commandId === id ? parsed.args : ""))}
          />
        ) : null}
        {query.trim() !== "" && entries.length === 0 ? rows(textLines(`No command matches "${query.trim()}".`, columns - 2, { role: "warning" })) : null}
        {top !== undefined && query.trim() !== "" ? (
          <Button key="favorite" hotkey="f" label={`f  ${top.isFavorite ? "Remove" : "Add"} /${top.command.slash} ${top.isFavorite ? "from" : "to"} favorites`} onPress={() => background(changeMemory($, (m) => toggleFavorite(m, top.command.id)))} />
        ) : null}
        {notice !== "" && data !== undefined ? rows(textLines(notice, columns - 2, { role: "muted" })) : null}
        {rows(textLines("Number keys pick an item. Tab and the arrow keys move, Enter chooses, Esc closes.", columns - 2, { role: "muted" }))}
      </Box>
    );
  });
}

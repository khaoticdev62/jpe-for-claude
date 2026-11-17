/**
 * The command palette's logic: what a typed query means, which commands it finds and in what order, and which
 * command a submit launches. Pure functions over the command list and the person's memory, so the same behaviour
 * serves the pane, the text fallback and the tests.
 *
 * What a query can mean:
 * - text: fuzzy-searches the commands (`ver` finds Verify)
 * - a number: picks that numbered item of the list as shown (`3`)
 * - a command and arguments: runs it with those arguments (`explain src/app.ts`, also `/jpe:explain src/app.ts`)
 */

import { CENTER_COMMANDS, findCommand, type CenterCommand } from "./commands.js";
import { fuzzyMatch } from "./fuzzy.js";
import { type CenterMemory, recentIds } from "./memory.js";

export interface PaletteEntry {
  command: CenterCommand;
  score: number;
  /** Positions in the title to highlight; empty when the match was on another field or there was no query. */
  titleMatch: readonly number[];
  isFavorite: boolean;
  /** ISO time of the last launch, when the command is in the history. */
  lastUsed?: string;
}

export type ParsedQuery = { kind: "search"; text: string } | { kind: "jump"; index: number } | { kind: "run"; commandId: string; args: string };

const MAX_JUMP = 99;
const MAX_ARGS_LENGTH = 500;

/** Removes a leading slash and `jpe:` / `jpe ` so `/jpe:verify`, `/jpe verify` and `verify` all mean the same. */
function normalize(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("/")) text = text.slice(1);
  const lower = text.toLowerCase();
  if (lower.startsWith("jpe:")) return text.slice(4).trimStart();
  if (lower.startsWith("jpe ")) return text.slice(4).trimStart();
  return text;
}

export function parseQuery(raw: string): ParsedQuery {
  const text = normalize(raw);
  if (/^\d{1,2}$/.test(text)) {
    const n = Number.parseInt(text, 10);
    if (n >= 1 && n <= MAX_JUMP) return { kind: "jump", index: n - 1 };
  }
  const space = text.search(/\s/);
  if (space > 0) {
    const first = text.slice(0, space).toLowerCase();
    const args = text.slice(space).trim();
    if (findCommand(first) !== undefined && args !== "") return { kind: "run", commandId: first, args: args.slice(0, MAX_ARGS_LENGTH) };
  }
  return { kind: "search", text };
}

function defaultOrder(memory: CenterMemory): CenterCommand[] {
  const ordered: CenterCommand[] = [];
  const push = (id: string): void => {
    const found = findCommand(id);
    if (found !== undefined && !ordered.includes(found)) ordered.push(found);
  };
  for (const id of memory.favorites) push(id);
  for (const id of recentIds(memory, CENTER_COMMANDS.length)) push(id);
  for (const c of CENTER_COMMANDS) push(c.id);
  return ordered;
}

const RECENCY_BONUS = 3;
const RECENCY_STEP = 0.5;
const FAVORITE_BONUS = 4;

function bestScore(query: string, c: CenterCommand): number | undefined {
  const fields: Array<[string, number]> = [[c.title, 1], [c.id, 1.2], ...c.keywords.map((k): [string, number] => [k, 0.8]), [c.summary, 0.4]];
  let best: number | undefined;
  for (const [text, weight] of fields) {
    const match = fuzzyMatch(query, text);
    if (match === undefined) continue;
    const weighted = match.score * weight;
    if (best === undefined || weighted > best) best = weighted;
  }
  return best;
}

/** The commands for a query, best first. With no query (or a number), favourites, then recent commands, then the rest. */
export function rankCommands(rawQuery: string, memory: CenterMemory): PaletteEntry[] {
  const parsed = parseQuery(rawQuery);
  const recent = recentIds(memory, CENTER_COMMANDS.length);
  const lastUsed = (id: string): string | undefined => memory.history.find((h) => h.id === id)?.at;
  const entryFor = (command: CenterCommand, score: number, titleMatch: readonly number[]): PaletteEntry => {
    const used = lastUsed(command.id);
    return { command, score, titleMatch, isFavorite: memory.favorites.includes(command.id), ...(used === undefined ? {} : { lastUsed: used }) };
  };

  if (parsed.kind !== "search" || parsed.text === "") {
    const order = defaultOrder(memory);
    const target = parsed.kind === "run" ? findCommand(parsed.commandId) : undefined;
    const list = target === undefined ? order : [target, ...order.filter((c) => c !== target)];
    return list.map((c) => entryFor(c, 0, []));
  }

  const results: PaletteEntry[] = [];
  CENTER_COMMANDS.forEach((command) => {
    const score = bestScore(parsed.text, command);
    if (score === undefined) return;
    const recency = recent.indexOf(command.id);
    const bonus = (memory.favorites.includes(command.id) ? FAVORITE_BONUS : 0) + (recency === -1 ? 0 : Math.max(0, RECENCY_BONUS - recency * RECENCY_STEP));
    results.push(entryFor(command, score + bonus, fuzzyMatch(parsed.text, command.title)?.indices ?? []));
  });
  // Array.prototype.sort is stable, so equal scores keep the registry order.
  return results.sort((a, b) => b.score - a.score);
}

export type Submission = { ok: true; commandId: string; args: string } | { ok: false; message: string };

/** What pressing Enter on a query launches: a typed command with arguments, a numbered item, or the best match. */
export function resolveSubmit(rawQuery: string, entries: readonly PaletteEntry[]): Submission {
  const parsed = parseQuery(rawQuery);
  if (parsed.kind === "run") return { ok: true, commandId: parsed.commandId, args: parsed.args };
  if (parsed.kind === "jump") {
    const entry = entries[parsed.index];
    return entry === undefined ? { ok: false, message: `There is no item ${parsed.index + 1} in the list.` } : { ok: true, commandId: entry.command.id, args: "" };
  }
  const top = entries[0];
  return top === undefined ? { ok: false, message: `No command matches "${parsed.text}".` } : { ok: true, commandId: top.command.id, args: "" };
}

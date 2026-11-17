/**
 * What the command center remembers between uses: which commands the person favourited and which they ran recently.
 *
 * It is plain data the person can see and clear, stored locally, never sent anywhere, and used only to order the
 * palette. Reading it is tolerant (a damaged or older record yields what is valid, never an error) and writing it is
 * capped, so it cannot grow without bound. The functions here are pure: storage belongs to the caller.
 */

import { isCommandId } from "./commands.js";

export const MEMORY_VERSION = 1;
export const MAX_FAVORITES = 20;
export const MAX_HISTORY = 50;

export interface HistoryEntry {
  id: string;
  /** ISO time the command was launched. */
  at: string;
}

export interface CenterMemory {
  version: typeof MEMORY_VERSION;
  /** Command ids in the order they were favourited. */
  favorites: string[];
  /** Most recent first. */
  history: HistoryEntry[];
}

export const EMPTY_MEMORY: CenterMemory = { version: MEMORY_VERSION, favorites: [], history: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isIso = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

/** Reads a stored value back into a valid memory, dropping anything unknown, malformed or duplicated. Never throws. */
export function parseMemory(raw: unknown): CenterMemory {
  if (!isRecord(raw)) return { ...EMPTY_MEMORY, favorites: [], history: [] };
  const favorites: string[] = [];
  if (Array.isArray(raw["favorites"])) {
    for (const id of raw["favorites"]) if (typeof id === "string" && isCommandId(id) && !favorites.includes(id)) favorites.push(id);
  }
  const history: HistoryEntry[] = [];
  if (Array.isArray(raw["history"])) {
    for (const entry of raw["history"]) {
      if (isRecord(entry) && typeof entry["id"] === "string" && isCommandId(entry["id"]) && isIso(entry["at"])) history.push({ id: entry["id"], at: entry["at"] });
    }
  }
  return { version: MEMORY_VERSION, favorites: favorites.slice(0, MAX_FAVORITES), history: history.slice(0, MAX_HISTORY) };
}

/** Records that a command was launched. Unknown ids are ignored. */
export function recordUse(memory: CenterMemory, id: string, at: string): CenterMemory {
  if (!isCommandId(id)) return memory;
  return { ...memory, history: [{ id, at }, ...memory.history].slice(0, MAX_HISTORY) };
}

/** Adds the command to the favourites, or removes it if it is already there. Unknown ids are ignored. */
export function toggleFavorite(memory: CenterMemory, id: string): CenterMemory {
  if (!isCommandId(id)) return memory;
  const favorites = memory.favorites.includes(id) ? memory.favorites.filter((f) => f !== id) : [...memory.favorites, id].slice(-MAX_FAVORITES);
  return { ...memory, favorites };
}

/** The distinct command ids launched most recently, newest first. */
export function recentIds(memory: CenterMemory, limit: number): string[] {
  const seen: string[] = [];
  for (const entry of memory.history) {
    if (!seen.includes(entry.id)) seen.push(entry.id);
    if (seen.length >= limit) break;
  }
  return seen;
}

/** Forgets the history but keeps the favourites. */
export const clearHistory = (memory: CenterMemory): CenterMemory => ({ ...memory, history: [] });

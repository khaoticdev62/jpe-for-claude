/**
 * Which version of JPE is running, how versions compare, and the one-time notice shown when it changes.
 *
 * Claude Code installs, updates and removes the plugin; JPE only notices the result. It remembers the last version it ran
 * as in a small per-user file, and says so once when the version differs. It never claims to know what changed beyond
 * pointing at the changelog.
 */

import path from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { CliContext } from "../cli/context.js";
import { dataDir } from "../config/paths.js";

/** The version of this build, from package.json (the single source of truth). */
export const PACKAGE_VERSION: string = pkg.version;

/** The plugin manifest on the main branch, which carries the latest published version. */
export const LATEST_MANIFEST_URL = "https://raw.githubusercontent.com/khaoticdev62/jpe-for-claude/master/.claude-plugin/plugin.json";
export const LATEST_MANIFEST_HOST = "raw.githubusercontent.com";

export type Triple = readonly [number, number, number];

/** `1.2.3` as numbers. Anything else (a pre-release tag, a missing part, text) is undefined: it is never guessed at. */
export function parseVersion(text: string): Triple | undefined {
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(text.trim());
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1 if `a` is older than `b`, 0 if equal, 1 if newer; undefined when either is not a plain x.y.z version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | undefined {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (x === undefined || y === undefined) return undefined;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const seenFile = (ctx: Pick<CliContext, "pathEnv">): string => path.join(dataDir(ctx.pathEnv), "version.json");

/** The version JPE last ran as, or undefined if it never recorded one or the record is unreadable. */
export async function readSeenVersion(ctx: Pick<CliContext, "pathEnv" | "readText">): Promise<string | undefined> {
  const text = await ctx.readText(seenFile(ctx)).catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    const version = typeof parsed === "object" && parsed !== null ? (parsed as { version?: unknown }).version : undefined;
    return typeof version === "string" && parseVersion(version) !== undefined ? version : undefined;
  } catch {
    return undefined;
  }
}

export async function recordSeenVersion(ctx: Pick<CliContext, "pathEnv" | "writeText" | "now">, version: string): Promise<void> {
  await ctx.writeText(seenFile(ctx), `${JSON.stringify({ version, at: ctx.now().toISOString() })}\n`);
}

export type VersionChange = { kind: "first" | "same" } | { kind: "updated" | "changed"; message: string };

/** What to say, if anything, given the version seen last time and the one running now. The very first run says nothing. */
export function describeVersionChange(previous: string | undefined, current: string): VersionChange {
  if (previous === undefined) return { kind: "first" };
  if (previous === current) return { kind: "same" };
  return compareVersions(previous, current) === -1
    ? { kind: "updated", message: `JPE was updated from ${previous} to ${current}. What changed is in CHANGELOG.md in the plugin folder, or on GitHub.` }
    : { kind: "changed", message: `JPE is now version ${current} (it was ${previous}).` };
}

export type UpdateCheck =
  | { state: "up-to-date"; installed: string; latest: string }
  | { state: "update-available"; installed: string; latest: string }
  | { state: "ahead"; installed: string; latest: string }
  | { state: "unknown"; installed: string; reason: string };

/** Compares the installed version with the latest published one, from the text of the published manifest. */
export function checkAgainstManifest(installed: string, manifestText: string): UpdateCheck {
  let latest: unknown;
  try {
    latest = (JSON.parse(manifestText) as { version?: unknown }).version;
  } catch {
    return { state: "unknown", installed, reason: "the published manifest was not valid JSON" };
  }
  if (typeof latest !== "string" || parseVersion(latest) === undefined) return { state: "unknown", installed, reason: "the published manifest has no readable version" };
  const order = compareVersions(installed, latest);
  if (order === undefined) return { state: "unknown", installed, reason: `the installed version "${installed}" is not a plain x.y.z version` };
  return { state: order === 0 ? "up-to-date" : order < 0 ? "update-available" : "ahead", installed, latest };
}

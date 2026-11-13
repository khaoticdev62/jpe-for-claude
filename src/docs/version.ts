import type { VersionMatch } from "./types.js";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

/** Parses "1.2.3", "v1.2", "1" and "1.2.3-beta.1". Returns undefined for anything else. */
export function parseVersion(input: string): ParsedVersion | undefined {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input.trim());
  if (!m?.[1]) return undefined;
  return { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0), prerelease: m[4] ?? "" };
}

/**
 * How closely the documented version matches the version actually in use.
 * For 0.x packages a minor bump is breaking, so only an identical minor counts as close.
 */
export function relateVersions(requested: string | undefined, documented: string | undefined): VersionMatch {
  if (requested === undefined) return "unknown-request";
  if (documented === undefined) return "unversioned";
  const a = parseVersion(requested);
  const b = parseVersion(documented);
  if (!a || !b) return "unversioned";
  if (a.major !== b.major) return "mismatch";
  if (a.minor === b.minor && a.patch === b.patch && a.prerelease === b.prerelease) return "exact";
  if (a.minor === b.minor) return "same-minor";
  return a.major === 0 ? "mismatch" : "same-major";
}

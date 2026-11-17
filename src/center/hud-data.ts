/**
 * The shape of the HUD facts and a validating reader for them. Pure data with no file or process access, so the
 * in-Claude-Code interface (which has no Node) can import it. Collecting the facts is in hud.ts.
 */

import type { CompletionStatus } from "../core/status.js";

export const HUD_VERSION = 1;

export type GitSummary =
  | { state: "unavailable" }
  | { state: "not-repo" }
  | { state: "clean"; branch: string }
  | { state: "dirty"; branch: string; changedFiles: number };

export interface VerificationSummary {
  status: CompletionStatus;
  /** ISO time of the run, when there was one. */
  at?: string;
  /** The first plain-English reasons behind the status (at most three). */
  reasons: string[];
  /** Names of the checks this project has (typecheck, lint, unit-test ...). */
  checksAvailable: string[];
  /** Set when the saved record could not be read; the status is then NOT_TESTED, never a guess. */
  problem?: string;
}

/** Whether the uncommitted changes have been reviewed, and whether the recorded decision still applies to them. */
export interface ReviewSummary {
  changedFiles: number;
  /** none = no decision recorded; current = a decision about exactly these changes; stale = a decision about different changes. */
  state: "none" | "current" | "stale";
  decision?: "approved" | "rejected";
  /** ISO time of the latest decision. */
  at?: string;
}

export interface HudData {
  hudVersion: typeof HUD_VERSION;
  generatedAt: string;
  project: { name: string; ecosystems: string[]; packageManager?: string };
  git: GitSummary;
  verification: VerificationSummary;
  /** Language servers the project would use but that are not installed, as "Language (binary)". */
  languageServersMissing: string[];
  runtime: { offline: boolean; approval: "risk-based" | "always" | "off" };
  /** Absent when there is no git repository to compare against. */
  review?: ReviewSummary;
}

const STATUSES: ReadonlySet<string> = new Set(["VERIFIED", "FUNCTIONAL_WITH_WARNINGS", "PARTIALLY_VERIFIED", "FAILED", "BLOCKED", "NOT_TESTED"]);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Checks that something read from `jpe center hud --json` really is a HUD this version understands, and returns it.
 * Returns undefined for anything else (a different version, a missing field, a wrong type), so the interface can say
 * "could not read project facts" instead of drawing from a half-understood value.
 */
export function parseHud(raw: unknown): HudData | undefined {
  if (!isRecord(raw) || raw["hudVersion"] !== HUD_VERSION || typeof raw["generatedAt"] !== "string") return undefined;
  const { project, git, verification, runtime } = raw as Record<string, unknown>;
  if (!isRecord(project) || typeof project["name"] !== "string" || !isStringArray(project["ecosystems"])) return undefined;
  if (!isRecord(git) || !["unavailable", "not-repo", "clean", "dirty"].includes(String(git["state"]))) return undefined;
  if ((git["state"] === "clean" || git["state"] === "dirty") && typeof git["branch"] !== "string") return undefined;
  if (git["state"] === "dirty" && typeof git["changedFiles"] !== "number") return undefined;
  if (!isRecord(verification) || !STATUSES.has(String(verification["status"])) || !isStringArray(verification["reasons"]) || !isStringArray(verification["checksAvailable"])) return undefined;
  if (verification["at"] !== undefined && typeof verification["at"] !== "string") return undefined;
  if (verification["problem"] !== undefined && typeof verification["problem"] !== "string") return undefined;
  if (!isStringArray(raw["languageServersMissing"])) return undefined;
  if (!isRecord(runtime) || typeof runtime["offline"] !== "boolean" || !["risk-based", "always", "off"].includes(String(runtime["approval"]))) return undefined;
  const review = raw["review"];
  if (review !== undefined) {
    if (!isRecord(review) || typeof review["changedFiles"] !== "number" || !Number.isInteger(review["changedFiles"]) || review["changedFiles"] < 0) return undefined;
    if (!["none", "current", "stale"].includes(String(review["state"]))) return undefined;
    if (review["decision"] !== undefined && !["approved", "rejected"].includes(String(review["decision"]))) return undefined;
    if (review["at"] !== undefined && typeof review["at"] !== "string") return undefined;
  }
  return raw as unknown as HudData;
}

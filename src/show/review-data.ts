/**
 * The data behind the review screen, and a validating reader for it. Pure, with no file or process access, so the
 * in-Claude-Code interface (which has no Node) can import it. The reader accepts only the exact shape that
 * `jpe show review --json` produces, and returns undefined for anything else, so a half-understood value is never drawn.
 */

import type { ChangeSummary, Hunk } from "../explain/diff.js";
import type { RiskFinding } from "../explain/analyze.js";
import type { ReviewFile, ReviewNote } from "./explain-views.js";

export interface ReviewDecisionState {
  /** none = no decision recorded; current = about exactly these changes; stale = about different changes. */
  state: "none" | "current" | "stale";
  fileCount: number;
  decision?: "approved" | "rejected";
  at?: string;
  note?: string;
}

export interface ReviewData {
  files: ReviewFile[];
  notes: ReviewNote[];
  checklist: string[];
  skipped: string[];
  /** Absent when it could not be determined. */
  decision?: ReviewDecisionState;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function isRisk(v: unknown): v is RiskFinding {
  return isRecord(v) && typeof v["id"] === "string" && isCount(v["line"]) && ["high", "medium", "low"].includes(String(v["severity"])) && typeof v["message"] === "string";
}

function isHunk(v: unknown): v is Hunk {
  return isRecord(v) && isCount(v["beforeStart"]) && isCount(v["afterStart"]) && isStrings(v["removed"]) && isStrings(v["added"]);
}

function isSummary(v: unknown): v is ChangeSummary {
  return (
    isRecord(v) &&
    typeof v["file"] === "string" &&
    isCount(v["added"]) &&
    isCount(v["removed"]) &&
    isCount(v["unchanged"]) &&
    Array.isArray(v["hunks"]) &&
    v["hunks"].every(isHunk) &&
    isStrings(v["symbolsAdded"]) &&
    isStrings(v["symbolsRemoved"]) &&
    Array.isArray(v["risksIntroduced"]) &&
    v["risksIntroduced"].every(isRisk) &&
    Array.isArray(v["risksResolved"]) &&
    v["risksResolved"].every(isRisk) &&
    typeof v["approximate"] === "boolean"
  );
}

function isFile(v: unknown): v is ReviewFile {
  return isRecord(v) && ["modified", "added", "deleted"].includes(String(v["status"])) && typeof v["isTest"] === "boolean" && isSummary(v["summary"]);
}

function isNote(v: unknown): v is ReviewNote {
  return isRecord(v) && ["confirmed", "heuristic"].includes(String(v["basis"])) && typeof v["text"] === "string";
}

function isDecisionState(v: unknown): v is ReviewDecisionState {
  if (!isRecord(v) || !["none", "current", "stale"].includes(String(v["state"])) || !isCount(v["fileCount"])) return false;
  if (v["decision"] !== undefined && !["approved", "rejected"].includes(String(v["decision"]))) return false;
  if (v["at"] !== undefined && typeof v["at"] !== "string") return false;
  return v["note"] === undefined || typeof v["note"] === "string";
}

/** Checks that something read from `jpe show review --json` is exactly the review data this version understands. */
export function parseReviewData(raw: unknown): ReviewData | undefined {
  if (!isRecord(raw) || !Array.isArray(raw["files"]) || !raw["files"].every(isFile)) return undefined;
  if (!Array.isArray(raw["notes"]) || !raw["notes"].every(isNote)) return undefined;
  if (!isStrings(raw["checklist"]) || !isStrings(raw["skipped"])) return undefined;
  if (raw["decision"] !== undefined && !isDecisionState(raw["decision"])) return undefined;
  return raw as unknown as ReviewData;
}

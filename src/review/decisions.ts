/**
 * Review decisions: a reviewer's "approved" or "rejected", recorded against the exact set of changes they looked at.
 *
 * A decision is a record, not an action. It never commits, stages or changes a file. It is tied to a fingerprint of the
 * changes (their paths and contents), so when anything changes afterwards the decision is reported as STALE instead of
 * silently standing for work the reviewer did not see. Records are append-only lines, read tolerantly, and capped.
 */

export const DECISIONS = ["approved", "rejected"] as const;
export type Decision = (typeof DECISIONS)[number];

export const MAX_NOTE_CHARS = 500;
export const MAX_RECORDS = 200;
const FINGERPRINT = /^[0-9a-f]{64}$/;

export interface ReviewDecision {
  id: string;
  /** ISO time the decision was recorded. */
  at: string;
  decision: Decision;
  fingerprint: string;
  fileCount: number;
  note?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads one stored line back into a decision, or undefined if it is not a valid record. Never throws. */
export function parseDecision(line: string): ReviewDecision | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;
  const { id, at, decision, fingerprint, fileCount, note } = raw;
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return undefined;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return undefined;
  if (!(DECISIONS as readonly unknown[]).includes(decision)) return undefined;
  if (typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint)) return undefined;
  if (typeof fileCount !== "number" || !Number.isInteger(fileCount) || fileCount < 0) return undefined;
  if (note !== undefined && typeof note !== "string") return undefined;
  return { id, at, decision: decision as Decision, fingerprint, fileCount, ...(note === undefined || note === "" ? {} : { note: note.slice(0, MAX_NOTE_CHARS) }) };
}

/** All valid decisions in a stored file, oldest first. Damaged lines are skipped. */
export function parseDecisions(text: string): ReviewDecision[] {
  return text.split(/\r?\n/).flatMap((line) => (line.trim() === "" ? [] : [parseDecision(line) ?? []].flat()));
}

/** The text to store: the existing decisions plus a new one, capped to the most recent. */
export function appendDecision(existing: readonly ReviewDecision[], added: ReviewDecision): string {
  return `${[...existing, added].slice(-MAX_RECORDS).map((d) => JSON.stringify(d)).join("\n")}\n`;
}

/** What the person wrote, made safe to store and show: one line, no control characters, at most 500 characters. */
export function cleanNote(raw: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the purpose.
  return raw.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS);
}

export type DecisionState = { kind: "none" } | { kind: "current"; decision: ReviewDecision } | { kind: "stale"; decision: ReviewDecision };

/**
 * Whether the latest decision still applies. It does only if the changes are exactly the ones that were reviewed.
 * With no uncommitted changes there is nothing to decide about, so an old decision is stale, never current.
 */
export function decisionState(decisions: readonly ReviewDecision[], currentFingerprint: string, changedFiles: number): DecisionState {
  const latest = decisions.at(-1);
  if (latest === undefined) return { kind: "none" };
  return changedFiles > 0 && latest.fingerprint === currentFingerprint ? { kind: "current", decision: latest } : { kind: "stale", decision: latest };
}

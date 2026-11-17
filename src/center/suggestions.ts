/**
 * "What should I do next?", answered from the HUD facts only.
 *
 * Each suggestion says what it is based on and whether that is a confirmed finding (something that was measured or
 * recorded) or only a suggestion (a sensible habit that the facts do not prove is needed). Nothing is predicted:
 * if the facts do not support a suggestion, it is not made.
 */

import type { HudData } from "./hud-data.js";

export type Basis = "confirmed" | "suggestion";
export type Level = "info" | "warning" | "error";

export interface Suggestion {
  /** Stable across runs, so a notification is shown once per session and not repeated. */
  id: string;
  commandId: string;
  args?: string;
  title: string;
  /** The evidence, in plain English. */
  why: string;
  basis: Basis;
  level: Level;
}

const MAX_SUGGESTIONS = 5;
const LEVEL_ORDER: Readonly<Record<Level, number>> = { error: 0, warning: 1, info: 2 };
const BASIS_ORDER: Readonly<Record<Basis, number>> = { confirmed: 0, suggestion: 1 };

/** The next steps the facts support, most urgent first, at most five. */
export function suggest(hud: HudData): Suggestion[] {
  const out: Suggestion[] = [];
  const v = hud.verification;

  if (v.problem !== undefined) {
    out.push({ id: "verification-record-damaged", commandId: "verify", title: "Run the checks again", why: v.problem, basis: "confirmed", level: "warning" });
  } else if (v.status === "FAILED") {
    out.push({ id: "verification-failed", commandId: "fix", title: "Fix the failing checks", why: `The last verification FAILED${v.reasons[0] === undefined ? "." : `: ${v.reasons[0]}`}`, basis: "confirmed", level: "error" });
  } else if (v.status === "BLOCKED") {
    out.push({ id: "verification-blocked", commandId: "status", title: "See what is blocking verification", why: `The last verification is BLOCKED${v.reasons[0] === undefined ? "." : `: ${v.reasons[0]}`}`, basis: "confirmed", level: "error" });
  } else if (v.status === "PARTIALLY_VERIFIED" || v.status === "FUNCTIONAL_WITH_WARNINGS") {
    out.push({ id: "verification-incomplete", commandId: "status", title: "See what is not fully verified", why: `The last verification is ${v.status}${v.reasons[0] === undefined ? "." : `: ${v.reasons[0]}`}`, basis: "confirmed", level: "warning" });
  } else if (v.status === "NOT_TESTED" && v.checksAvailable.length > 0) {
    out.push({ id: "verification-not-run", commandId: "verify", title: "Run the project's checks", why: `Nothing has been verified yet, and this project has: ${v.checksAvailable.join(", ")}.`, basis: "confirmed", level: "info" });
  }

  if (hud.languageServersMissing.length > 0) {
    out.push({ id: "language-servers-missing", commandId: "setup", title: "Set up language servers", why: `Not installed: ${hud.languageServersMissing.join(", ")}. Without one, nothing is checked by the language server.`, basis: "confirmed", level: "warning" });
  }

  const alreadyVerifying = out.some((s) => s.commandId === "verify");
  if (hud.git.state === "dirty" && v.checksAvailable.length > 0 && v.status !== "FAILED" && !alreadyVerifying) {
    const n = hud.git.changedFiles;
    out.push({ id: "uncommitted-changes", commandId: "verify", title: "Verify before you commit", why: `${n} uncommitted ${n === 1 ? "file" : "files"}. This is a habit, not a finding: JPE cannot tell whether the last verification covers them.`, basis: "suggestion", level: "info" });
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || BASIS_ORDER[a.basis] - BASIS_ORDER[b.basis]).slice(0, MAX_SUGGESTIONS);
}

/** The suggestions worth interrupting for: confirmed findings at warning level or above. Suggestions never notify. */
export const notifications = (hud: HudData): Suggestion[] => suggest(hud).filter((s) => s.basis === "confirmed" && s.level !== "info");

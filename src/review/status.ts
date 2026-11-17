import path from "node:path";
import type { CliContext } from "../cli/context.js";
import { reviewFingerprint } from "./changes.js";
import { type DecisionState, decisionState, parseDecisions, type ReviewDecision } from "./decisions.js";

/** The file, in the project's state folder, that holds the review decisions. */
export const DECISIONS_FILE = "reviews.jsonl";

/** Every recorded decision for this project, oldest first. A missing or damaged file reads as no decisions. */
export async function loadDecisions(ctx: Pick<CliContext, "stateDir" | "readText">): Promise<ReviewDecision[]> {
  const text = await ctx.readText(path.join(ctx.stateDir(), DECISIONS_FILE)).catch(() => undefined);
  return text === undefined ? [] : parseDecisions(text);
}

export interface ReviewStatus {
  state: DecisionState;
  fileCount: number;
  fingerprint: string;
}

/** Whether the latest decision still applies to the changes as they are now. Throws if there is no git repository. */
export async function currentReviewStatus(ctx: Pick<CliContext, "git" | "cwd" | "fs" | "stateDir" | "readText">): Promise<ReviewStatus> {
  const { fingerprint, fileCount } = await reviewFingerprint(ctx);
  return { state: decisionState(await loadDecisions(ctx), fingerprint, fileCount), fileCount, fingerprint };
}

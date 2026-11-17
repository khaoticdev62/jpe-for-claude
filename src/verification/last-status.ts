import path from "node:path";
import { z } from "zod";
import type { CliContext } from "../cli/context.js";
import { checkNameSchema } from "../core/evidence.js";
import { parseEvidenceLines } from "../core/ledger.js";
import { deriveStatus, type StatusReport } from "../core/status.js";

/** What `jpe verify` records next to its evidence: when it ran and which checks applied. */
export const runMetaSchema = z.strictObject({ at: z.iso.datetime(), required: z.array(checkNameSchema) });

export interface LastStatus {
  report: StatusReport;
  /** ISO time of the run that produced the evidence. */
  at: string;
}

/**
 * The status of the most recent `jpe verify` run, re-derived from its saved evidence (never from a stored label).
 * Returns undefined when this project has never been verified. Throws if the saved files are damaged, so callers
 * decide how to report that; nothing here ever invents a status.
 */
export async function readLastStatus(ctx: Pick<CliContext, "stateDir" | "readText">): Promise<LastStatus | undefined> {
  const dir = ctx.stateDir();
  const ledgerText = await ctx.readText(path.join(dir, "ledger.jsonl"));
  const metaText = await ctx.readText(path.join(dir, "run.json"));
  if (ledgerText === undefined || metaText === undefined) return undefined;
  const meta = runMetaSchema.parse(JSON.parse(metaText));
  return { report: deriveStatus(parseEvidenceLines(ledgerText), meta.required), at: meta.at };
}

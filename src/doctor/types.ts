import type { CliContext } from "../cli/context.js";

export type FindingStatus = "ok" | "info" | "warn" | "fail";

export type RepairId = "create-data-dirs" | "remove-corrupt-cache" | "remove-stale-sessions" | "prune-old-backups";

export interface Finding {
  id: string;
  area: string;
  status: FindingStatus;
  /** One plain-English sentence saying what was found. */
  title: string;
  detail?: string;
  /** What to do about it, in plain English. */
  fix?: string;
  /** A safe local repair that `--repair` can perform for this finding. */
  repair?: RepairId;
}

export interface DoctorEnv {
  ctx: CliContext;
  /** Folder that contains .claude-plugin/, skills/, agents/ and dist/; undefined when it cannot be found. */
  pluginRoot: string | undefined;
  /** Also test network reachability and start the language servers. */
  deep: boolean;
  nodeVersion: string;
}

export interface DoctorReport {
  generatedAt: string;
  overall: FindingStatus;
  findings: Finding[];
  repairs: Array<{ id: RepairId; done: boolean; message: string }>;
}

export const ORDER: Record<FindingStatus, number> = { ok: 0, info: 0, warn: 1, fail: 2 };

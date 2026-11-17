/**
 * The HUD: a handful of real facts about the project that the command center shows at all times.
 *
 * Every field is read from something that exists (the manifest, git, the saved verification evidence, the language
 * servers on PATH, the configuration). Nothing is predicted or filled in: when a fact cannot be read the field says
 * so ("unavailable", NOT_TESTED) instead of guessing, and a damaged verification record is reported, not hidden.
 */

import path from "node:path";
import type { CliContext } from "../cli/context.js";
import { discoverChecks } from "../project/checks.js";
import { detectProject } from "../project/detect.js";
import { detectLanguages, findOnPath, listProjectFiles } from "../lsp/detect.js";
import { readGitState } from "../project/git.js";
import { readLastStatus } from "../verification/last-status.js";
import { type GitSummary, HUD_VERSION, type HudData, type VerificationSummary } from "./hud-data.js";

export { HUD_VERSION, parseHud } from "./hud-data.js";
export type { GitSummary, HudData, VerificationSummary } from "./hud-data.js";

const MAX_REASONS = 3;
const MAX_SERVER_CHECKS = 4;

async function readVerification(ctx: CliContext, checksAvailable: string[]): Promise<VerificationSummary> {
  try {
    const last = await readLastStatus(ctx);
    if (last === undefined) return { status: "NOT_TESTED", reasons: ["No verification has been run for this project yet."], checksAvailable };
    return { status: last.report.status, at: last.at, reasons: last.report.reasons.slice(0, MAX_REASONS), checksAvailable };
  } catch {
    return { status: "NOT_TESTED", reasons: [], checksAvailable, problem: "The saved verification record is damaged. Run /jpe:verify again to replace it." };
  }
}

/** Gathers the HUD facts for the project in `ctx.cwd`. Read-only: it runs no project command and changes nothing. */
export async function collectHud(ctx: CliContext): Promise<HudData> {
  const config = await ctx.loadConfig();
  const project = await detectProject(ctx.cwd, ctx.fs);
  const checks = await discoverChecks(project, ctx.fs);
  const checksAvailable = [...new Set(checks.map((c) => c.check))];

  const gitState = await readGitState(ctx.git).catch(() => undefined);
  const git: GitSummary =
    gitState === undefined || !gitState.available
      ? { state: "unavailable" }
      : !gitState.isRepo
        ? { state: "not-repo" }
        : gitState.dirty
          ? { state: "dirty", branch: gitState.branch ?? "(unknown)", changedFiles: gitState.changedFiles.length }
          : { state: "clean", branch: gitState.branch ?? "(unknown)" };

  const files = await listProjectFiles(ctx.cwd, ctx.git).catch(() => []);
  const lookup = { platform: ctx.pathEnv.platform, env: ctx.pathEnv.env, exists: (f: string) => ctx.fs.exists(f) };
  const missing: string[] = [];
  for (const { language } of detectLanguages(files).slice(0, MAX_SERVER_CHECKS)) {
    const label = `${language.name} (${language.server.binary})`;
    if (!(await findOnPath(language.server.binary, lookup)) && !missing.includes(label)) missing.push(label);
  }

  return {
    hudVersion: HUD_VERSION,
    generatedAt: ctx.now().toISOString(),
    project: { name: path.basename(ctx.cwd) || ctx.cwd, ecosystems: project.ecosystems, ...(project.packageManager === undefined ? {} : { packageManager: project.packageManager }) },
    git,
    verification: await readVerification(ctx, checksAvailable),
    languageServersMissing: missing,
    runtime: { offline: config.runtime.offline, approval: config.engineering.approval },
  };
}

import path from "node:path";
import { dataDir } from "../../config/paths.js";
import { JpeError } from "../../core/errors.js";
import { DocCache } from "../../docs/cache.js";
import { formatReport, type ResearchReport, researchDocs } from "../../docs/engine.js";
import { blockedNetDeps } from "../../docs/net.js";
import { localPackageProvider } from "../../docs/providers/local-package.js";
import { officialProvider } from "../../docs/providers/official.js";
import { osvProvider } from "../../docs/providers/osv.js";
import { repoReleaseProvider } from "../../docs/providers/repo-release.js";
import type { DocProvider } from "../../docs/types.js";
import { detectProject } from "../../project/detect.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";

export const PROVIDERS: Record<string, DocProvider> = {
  "local-package": localPackageProvider,
  official: officialProvider,
  "repo-release": repoReleaseProvider,
  osv: osvProvider,
};

export interface ResearchRun {
  report: ResearchReport;
  /** Said first: why version matching is limited, when it is. Empty when the exact version is known. */
  versionNote: string;
  /** Said last: Context7 is queried by the researcher agent, not here. Empty when it is not configured. */
  context7Note: string;
}

/**
 * Runs version-aware documentation research for `<library>` (the first positional argument), using the configured
 * providers and the local cache. Shared by `jpe research` (text for Claude) and `jpe show docs` (the rich view), so the
 * two can never research differently.
 */
export async function runResearch(args: ParsedArgs, ctx: CliContext): Promise<ResearchRun> {
  const library = args.positionals[0];
  if (!library) throw new JpeError("INVALID_INPUT", "Usage: jpe research <library> [--topic <what you need>] [--version <exact>] [--offline]");
  const cfg = await ctx.loadConfig();
  const project = await detectProject(ctx.cwd, ctx.fs);
  const dep = project.dependencies.find((d) => d.name === library);

  const explicit = flagString(args, "version");
  const exact = explicit ?? (dep && dep.versionSource !== "declared" ? dep.version : undefined);
  const versionNote =
    explicit || exact
      ? ""
      : dep
        ? `NOTE: only the declared range "${dep.declared}" is known for ${library}, not the exact installed version, so version matching is limited. Install dependencies for exact results.\n`
        : `NOTE: ${library} is not a dependency of this project, so no version could be determined.\n`;

  const extraHosts = cfg.docs.additionalProviders.map((p) => new URL(p.baseUrl).hostname.toLowerCase());
  const providers = cfg.docs.providers.flatMap((name) => (PROVIDERS[name] ? [PROVIDERS[name]] : []));
  // Offline is enforced twice: the engine skips network sources, and the network handle itself refuses, so a source that forgot to check could still not reach out.
  const offline = cfg.runtime.offline || flagBool(args, "offline");
  const report = await researchDocs(
    { library, ...(exact ? { version: exact } : {}), topic: flagString(args, "topic") ?? library, ecosystem: dep?.ecosystem ?? project.ecosystems[0] ?? "node" },
    {
      providers,
      cache: new DocCache({ dir: path.join(dataDir(ctx.pathEnv), "docs-cache"), now: ctx.now, ttlHours: cfg.docs.cacheTtlHours }),
      context: { fs: ctx.fs, projectRoot: ctx.cwd, net: offline ? blockedNetDeps() : ctx.net, extraHosts, requestTimeoutMs: cfg.docs.requestTimeoutMs },
      offline,
      now: ctx.now,
    },
  );
  const context7Note = cfg.docs.providers.includes("context7") ? "\nContext7: not queried by this command. The jpe-researcher agent queries it through its MCP tools; treat its output as third-party and unversioned.\n" : "";
  return { report, versionNote, context7Note };
}

/** `jpe research <library> [--topic t] [--version v] [--offline]`: version-aware documentation research. */
export async function researchCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const { report, versionNote, context7Note } = await runResearch(args, ctx);
  ctx.out(versionNote + formatReport(report) + context7Note);
  return 0;
}

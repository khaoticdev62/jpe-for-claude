import { dataDir } from "../../config/paths.js";
import { JpeError } from "../../core/errors.js";
import { DocCache } from "../../docs/cache.js";
import { formatReport, researchDocs } from "../../docs/engine.js";
import { localPackageProvider } from "../../docs/providers/local-package.js";
import { officialProvider } from "../../docs/providers/official.js";
import { osvProvider } from "../../docs/providers/osv.js";
import { repoReleaseProvider } from "../../docs/providers/repo-release.js";
import type { DocProvider } from "../../docs/types.js";
import { detectProject } from "../../project/detect.js";
import path from "node:path";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";

const PROVIDERS: Record<string, DocProvider> = {
  "local-package": localPackageProvider,
  official: officialProvider,
  "repo-release": repoReleaseProvider,
  osv: osvProvider,
};

/** `jpe research <library> [--topic t] [--version v] [--offline]`: version-aware documentation research. */
export async function researchCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
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
  const report = await researchDocs(
    { library, ...(exact ? { version: exact } : {}), topic: flagString(args, "topic") ?? library, ecosystem: dep?.ecosystem ?? project.ecosystems[0] ?? "node" },
    {
      providers,
      cache: new DocCache({ dir: path.join(dataDir(ctx.pathEnv), "docs-cache"), now: ctx.now, ttlHours: cfg.docs.cacheTtlHours }),
      context: { fs: ctx.fs, projectRoot: ctx.cwd, net: ctx.net, extraHosts, requestTimeoutMs: cfg.docs.requestTimeoutMs },
      offline: cfg.runtime.offline || flagBool(args, "offline"),
      now: ctx.now,
    },
  );
  const context7 = cfg.docs.providers.includes("context7") ? "\nContext7: not queried by this command. The jpe-researcher agent queries it through its MCP tools; treat its output as third-party and unversioned.\n" : "";
  ctx.out(versionNote + formatReport(report) + context7);
  return 0;
}

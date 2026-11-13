import path from "node:path";
import { z } from "zod";
import { NPM_NAME } from "../../project/detect.js";
import { JpeError } from "../../core/errors.js";
import { safeRequest } from "../net.js";
import type { DocProvider } from "../types.js";

const MAX_NOTES_CHARS = 8_000;

const pkgSchema = z.looseObject({ repository: z.union([z.string(), z.looseObject({ url: z.string().optional() })]).optional() });
const releaseSchema = z.looseObject({ name: z.string().nullable().optional(), tag_name: z.string().optional(), body: z.string().nullable().optional(), html_url: z.string().optional() });

/** Extracts owner/repo from the common repository spellings ("git+https://github.com/o/r.git", "github:o/r", "o/r"). */
export function parseGithubRepo(input: string): { owner: string; repo: string } | undefined {
  const m =
    /^(?:git\+)?(?:https?|git|ssh):\/\/(?:[^@/]+@)?github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#].*)?$/.exec(input) ??
    /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(input) ??
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(input);
  return m?.[1] && m[2] ? { owner: m[1], repo: m[2] } : undefined;
}

/** Release notes for the exact installed version, from the package's GitHub repository. */
export const repoReleaseProvider: DocProvider = {
  name: "repo-release",
  needsNetwork: true,
  async fetch(request, ctx) {
    if (request.ecosystem !== "node") return { results: [], notes: ["Release-note lookup currently supports npm packages only."] };
    if (!request.version) return { results: [], notes: ["An exact version is needed to find its release notes."] };
    if (!NPM_NAME.test(request.library)) return { results: [], notes: [`"${request.library.slice(0, 60)}" is not a valid npm package name.`] };

    const pkgText = await ctx.fs.readText(path.join(ctx.projectRoot, "node_modules", request.library, "package.json"));
    let repoField: string | undefined;
    if (pkgText !== undefined) {
      try {
        const parsed = pkgSchema.safeParse(JSON.parse(pkgText));
        if (parsed.success) repoField = typeof parsed.data.repository === "string" ? parsed.data.repository : parsed.data.repository?.url;
      } catch {
        // malformed package.json: handled by the "no repository" note below
      }
    }
    const repo = repoField ? parseGithubRepo(repoField) : undefined;
    if (!repo) return { results: [], notes: [`No GitHub repository is declared by the installed ${request.library}, so release notes were not looked up.`] };

    for (const tag of [`v${request.version}`, request.version]) {
      const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(tag)}`;
      try {
        const res = await safeRequest({ url, accept: "application/vnd.github+json", allowedHosts: ["api.github.com"], timeoutMs: ctx.requestTimeoutMs }, ctx.net);
        const release = releaseSchema.safeParse(JSON.parse(res.text));
        if (!release.success) continue;
        const body = release.data.body ?? "(this release has no written notes)";
        return {
          results: [{
            provider: "repo-release",
            kind: "release-notes",
            title: `${repo.owner}/${repo.repo} release ${release.data.tag_name ?? tag}`,
            ...(release.data.html_url ? { url: release.data.html_url } : {}),
            content: body.slice(0, MAX_NOTES_CHARS),
            trust: "official",
            docVersion: request.version,
          }],
          notes: [],
        };
      } catch (error) {
        const notFound = error instanceof JpeError && /HTTP 404/.test(error.userMessage);
        if (!notFound) throw error;
      }
    }
    return { results: [], notes: [`No GitHub release was found for ${repo.owner}/${repo.repo} at v${request.version}.`] };
  },
};

import { z } from "zod";
import { NPM_NAME } from "../../project/detect.js";
import { htmlToText, safeRequest } from "../net.js";
import type { DocDraft, DocProvider } from "../types.js";
import { focusOnTopic } from "./local-package.js";

const registrySchema = z.looseObject({
  version: z.string().optional(),
  description: z.string().optional(),
  homepage: z.string().optional(),
  license: z.string().optional(),
  deprecated: z.string().optional(),
});

/**
 * Official sources for an npm package: registry metadata for the exact version (including any
 * deprecation notice) and the project's own homepage, which is fetched through the guarded client.
 */
export const officialProvider: DocProvider = {
  name: "official",
  needsNetwork: true,
  async fetch(request, ctx) {
    if (request.ecosystem !== "node") return { results: [], notes: ["The official-site provider currently supports npm packages only."] };
    if (!NPM_NAME.test(request.library)) return { results: [], notes: [`"${request.library.slice(0, 60)}" is not a valid npm package name.`] };

    const results: DocDraft[] = [];
    const notes: string[] = [];
    const encoded = request.library.replace("/", "%2F");
    const registryUrl = `https://registry.npmjs.org/${encoded}/${encodeURIComponent(request.version ?? "latest")}`;
    const reg = await safeRequest({ url: registryUrl, accept: "application/json", allowedHosts: ["registry.npmjs.org"], timeoutMs: ctx.requestTimeoutMs }, ctx.net);

    let json: unknown;
    try {
      json = JSON.parse(reg.text);
    } catch {
      return { results, notes: ["The npm registry returned something that was not JSON."] };
    }
    const meta = registrySchema.safeParse(json);
    if (!meta.success) return { results, notes: ["The npm registry response had an unexpected shape."] };
    const { version, description, homepage, license, deprecated } = meta.data;
    const content = [
      `Registry entry: ${request.library}@${version ?? request.version ?? "latest"}`,
      description ? `Description: ${description}` : "",
      license ? `License: ${license}` : "",
      deprecated ? `DEPRECATED by its maintainers: ${deprecated}` : "No deprecation notice in the registry for this version.",
      homepage ? `Homepage: ${homepage}` : "",
    ].filter(Boolean).join("\n");
    results.push({
      provider: "official",
      kind: "metadata",
      title: `${request.library}@${version ?? "latest"} (npm registry)`,
      url: reg.url,
      content,
      trust: "registry",
      ...(version ? { docVersion: version } : {}),
    });

    if (homepage?.startsWith("https://")) {
      try {
        const host = new URL(homepage).hostname.toLowerCase();
        const page = await safeRequest({ url: homepage, allowedHosts: [host, ...ctx.extraHosts], timeoutMs: ctx.requestTimeoutMs, maxBytes: 2 * 1024 * 1024 }, ctx.net);
        const text = /html/i.test(page.contentType) ? htmlToText(page.text) : page.text;
        results.push({
          provider: "official",
          kind: "reference",
          title: `${request.library} project site`,
          url: page.url,
          content: focusOnTopic(text, request.topic, 8000),
          trust: "official",
        });
        notes.push("The project homepage is not version-specific; it may describe a different version than the one installed.");
      } catch (error) {
        notes.push(`The project homepage could not be read (${error instanceof Error ? error.message : "unknown error"}).`);
      }
    } else if (homepage) {
      notes.push("The package homepage is not an https address, so it was not fetched.");
    }
    return { results, notes };
  },
};

import { z } from "zod";
import { safeRequest } from "../net.js";
import type { DocProvider } from "../types.js";

const OSV_ECOSYSTEM = { node: "npm", python: "PyPI", rust: "crates.io", go: "Go" } as const;
const MAX_LISTED = 20;

const responseSchema = z.looseObject({
  vulns: z
    .array(z.looseObject({ id: z.string(), summary: z.string().optional(), aliases: z.array(z.string()).optional(), published: z.string().optional() }))
    .optional(),
});

/** Known security advisories for the exact version, from the OSV database (osv.dev). */
export const osvProvider: DocProvider = {
  name: "osv",
  needsNetwork: true,
  async fetch(request, ctx) {
    if (!request.version) return { results: [], notes: ["An exact version is needed to check security advisories."] };
    const ecosystem = OSV_ECOSYSTEM[request.ecosystem];
    const res = await safeRequest(
      {
        url: "https://api.osv.dev/v1/query",
        method: "POST",
        body: JSON.stringify({ version: request.version, package: { name: request.library, ecosystem } }),
        accept: "application/json",
        allowedHosts: ["api.osv.dev"],
        timeoutMs: ctx.requestTimeoutMs,
      },
      ctx.net,
    );
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      return { results: [], notes: ["OSV returned something that was not JSON."] };
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) return { results: [], notes: ["OSV returned an unexpected response shape."] };
    const vulns = parsed.data.vulns ?? [];
    const title = `Security advisories for ${request.library}@${request.version} (OSV)`;
    const content =
      vulns.length === 0
        ? `OSV lists no known advisories for ${request.library}@${request.version} (${ecosystem}) as of this lookup.`
        : [
            `${vulns.length} known advisor${vulns.length === 1 ? "y" : "ies"} for ${request.library}@${request.version} (${ecosystem}):`,
            ...vulns.slice(0, MAX_LISTED).map((v) => `- ${v.id}${v.aliases?.length ? ` (${v.aliases.join(", ")})` : ""}: ${v.summary ?? "no summary"}`),
            vulns.length > MAX_LISTED ? `...and ${vulns.length - MAX_LISTED} more.` : "",
          ].filter(Boolean).join("\n");
    return { results: [{ provider: "osv", kind: "advisory", title, url: "https://osv.dev", content, trust: "official", docVersion: request.version }], notes: [] };
  },
};

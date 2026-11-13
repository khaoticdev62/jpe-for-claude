import path from "node:path";
import { z } from "zod";
import { NPM_NAME } from "../../project/detect.js";
import { resolveInside } from "../../security/paths.js";
import type { DocDraft, DocProvider } from "../types.js";

const pkgSchema = z.looseObject({
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  homepage: z.string().optional(),
  deprecated: z.string().optional(),
  types: z.string().optional(),
  typings: z.string().optional(),
});

const MAX_README_CHARS = 8_000;
const MAX_TYPES_CHARS = 30_000;

/** Keeps lines near mentions of the topic (so the answer is the relevant part of a big file); falls back to the start. */
export function focusOnTopic(text: string, topic: string, maxChars: number, window = 8): string {
  const words = topic.toLowerCase().split(/[^a-z0-9_$]+/).filter((w) => w.length >= 3);
  const lines = text.split(/\r?\n/);
  if (words.length > 0) {
    const keep = new Set<number>();
    lines.forEach((line, i) => {
      const lower = line.toLowerCase();
      if (words.some((w) => lower.includes(w))) for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + window); j++) keep.add(j);
    });
    if (keep.size > 0) {
      const picked: string[] = [];
      let last = -2;
      for (const i of [...keep].sort((a, b) => a - b)) {
        if (i !== last + 1 && picked.length > 0) picked.push("...");
        picked.push(lines[i] ?? "");
        last = i;
      }
      return picked.join("\n").slice(0, maxChars);
    }
  }
  return text.slice(0, maxChars);
}

/**
 * Reads the INSTALLED npm package from node_modules: its metadata, README and type declarations.
 * The declarations are the authoritative API signatures for the version actually in use, and this
 * provider works fully offline.
 */
export const localPackageProvider: DocProvider = {
  name: "local-package",
  needsNetwork: false,
  async fetch(request, ctx) {
    if (request.ecosystem !== "node") return { results: [], notes: ["Local package inspection currently supports npm packages only."] };
    if (!NPM_NAME.test(request.library)) return { results: [], notes: [`"${request.library.slice(0, 60)}" is not a valid npm package name.`] };

    const dir = path.join(ctx.projectRoot, "node_modules", request.library);
    const pkgText = await ctx.fs.readText(path.join(dir, "package.json"));
    const parsed = pkgText === undefined ? undefined : pkgSchema.safeParse(safeJson(pkgText));
    if (!parsed?.success) return { results: [], notes: [`${request.library} is not installed in node_modules, so it could not be inspected locally.`] };

    const pkg = parsed.data;
    const version = pkg.version;
    const base = { provider: "local-package", trust: "local" as const, ...(version ? { docVersion: version } : {}) };
    const results: DocDraft[] = [];
    const notes: string[] = [];

    const meta = [
      `Installed: ${request.library}@${version ?? "unknown"}`,
      pkg.description ? `Description: ${pkg.description}` : "",
      pkg.deprecated ? `DEPRECATED by its maintainers: ${pkg.deprecated}` : "",
      pkg.homepage ? `Homepage: ${pkg.homepage}` : "",
    ].filter(Boolean).join("\n");
    results.push({ ...base, kind: "metadata", title: `${request.library}@${version ?? "?"} (installed package)`, content: meta });

    for (const name of ["README.md", "readme.md", "Readme.md"]) {
      const readme = await ctx.fs.readText(path.join(dir, name));
      if (readme !== undefined) {
        results.push({ ...base, kind: "reference", title: `${request.library} README (installed copy)`, content: focusOnTopic(readme, request.topic, MAX_README_CHARS) });
        break;
      }
    }

    const typesField = pkg.types ?? pkg.typings;
    const candidates = [typesField, "index.d.ts", "dist/index.d.ts"].filter((c): c is string => typeof c === "string");
    let foundTypes = false;
    for (const candidate of candidates) {
      let file: string;
      try {
        file = resolveInside(dir, candidate);
      } catch {
        notes.push("Skipped a type-declaration path that pointed outside the package.");
        continue;
      }
      const dts = await ctx.fs.readText(file);
      if (dts !== undefined) {
        const found = await collectDeclarations(dir, file, dts, request.topic, (f) => ctx.fs.readText(f));
        results.push({ ...base, kind: "api-signature", title: `${request.library} type declarations (${candidate}${found.files > 1 ? ` and ${found.files - 1} re-exported file(s)` : ""})`, content: found.content });
        if (!found.topicFound && topicWords(request.topic).length > 0) notes.push(`"${request.topic}" does not appear in ${request.library}'s type declarations; it may not exist in the installed version.`);
        foundTypes = true;
        break;
      }
    }
    if (!foundTypes) notes.push(`${request.library} ships no type declarations, so API signatures could not be read locally.`);
    return { results, notes };
  },
};

const MAX_DECLARATION_FILES = 40;
const REEXPORT = /(?:^|\n)\s*(?:export|import)\s[^;]*?from\s*["'](\.{1,2}\/[^"']+)["']/g;

function topicWords(topic: string): string[] {
  return topic.toLowerCase().split(/[^a-z0-9_$]+/).filter((w) => w.length >= 3);
}

/** Declaration file names TypeScript would look for when a .d.ts file re-exports `spec`. */
function declarationCandidates(fromFile: string, spec: string): string[] {
  const base = path.resolve(path.dirname(fromFile), spec);
  const mapped = base.replace(/\.(c|m)?js$/, (_m, k: string | undefined) => `.d.${k ?? ""}ts`);
  return [...new Set([mapped, `${base}.d.ts`, `${base}.d.cts`, `${base}.d.mts`, path.join(base, "index.d.ts"), path.join(base, "index.d.cts")])];
}

/**
 * Reads the entry declaration file and, when the topic is not in it, follows relative re-exports
 * (bounded, never leaving the package folder) so signatures behind `export * from "./x"` are found.
 */
async function collectDeclarations(
  packageDir: string,
  entry: string,
  entryText: string,
  topic: string,
  read: (file: string) => Promise<string | undefined>,
): Promise<{ content: string; topicFound: boolean; files: number }> {
  const words = topicWords(topic);
  const mentions = (text: string): boolean => words.some((w) => text.toLowerCase().includes(w));
  if (words.length === 0 || mentions(entryText)) return { content: focusOnTopic(entryText, topic, MAX_TYPES_CHARS), topicFound: words.length > 0, files: 1 };

  const seen = new Set<string>([path.normalize(entry)]);
  const queue: Array<{ file: string; text: string }> = [{ file: entry, text: entryText }];
  const excerpts: string[] = [];
  let used = 0;
  while (queue.length > 0 && seen.size <= MAX_DECLARATION_FILES) {
    const current = queue.shift() as { file: string; text: string };
    for (const m of current.text.matchAll(REEXPORT)) {
      for (const candidate of declarationCandidates(current.file, m[1] ?? "")) {
        const normal = path.normalize(candidate);
        if (seen.has(normal)) continue;
        try {
          resolveInside(packageDir, path.relative(packageDir, normal));
        } catch {
          continue; // never follow a re-export out of the package
        }
        const text = await read(normal);
        if (text === undefined) continue;
        seen.add(normal);
        queue.push({ file: normal, text });
        if (mentions(text) && used < MAX_TYPES_CHARS) {
          const excerpt = `// ${path.relative(packageDir, normal).split(path.sep).join("/")}\n${focusOnTopic(text, topic, Math.min(8000, MAX_TYPES_CHARS - used))}`;
          excerpts.push(excerpt);
          used += excerpt.length;
        }
        break;
      }
    }
  }
  return excerpts.length > 0
    ? { content: excerpts.join("\n\n"), topicFound: true, files: seen.size }
    : { content: focusOnTopic(entryText, topic, MAX_TYPES_CHARS), topicFound: false, files: seen.size };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

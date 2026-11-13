import path from "node:path";
import { LspClient, type Position } from "./client.js";

export interface FileReferences {
  file: string;
  count: number;
}

export interface ImpactReport {
  /** lsp = exact references from a language server; text-search = import statements found by scanning. */
  method: "lsp" | "text-search";
  target: string;
  referencingFiles: FileReferences[];
  truncated: boolean;
  /** What this analysis cannot see, in plain English. */
  limitations: string[];
}

/** Which files use the symbol at `position`, according to the language server. */
export async function impactViaLsp(client: LspClient, file: string, position: Position, maxFiles = 200): Promise<ImpactReport> {
  const refs = await client.references(file, position);
  const counts = new Map<string, number>();
  for (const r of refs) counts.set(r.file, (counts.get(r.file) ?? 0) + 1);
  const all = [...counts.entries()].map(([f, count]) => ({ file: f, count })).sort((a, b) => b.count - a.count);
  return {
    method: "lsp",
    target: file,
    referencingFiles: all.slice(0, maxFiles),
    truncated: all.length > maxFiles,
    limitations: refs.length === 0 ? ["The server reported no references. The symbol may be unused, or the server may not have finished indexing."] : [],
  };
}

export interface TextImpactDeps {
  listFiles: () => Promise<string[]>;
  readText: (file: string) => Promise<string | undefined>;
  root: string;
}

const JS_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
const MAX_SCAN_FILES = 2000;
const MAX_SCAN_BYTES = 512 * 1024;
const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

const stripExt = (p: string): string => p.replace(/\.[^./\\]+$/, "");

/**
 * Fallback when no language server is available: finds JS/TS files that import the target module
 * (relative imports) or Python files that import its module name, by scanning source text.
 * It sees imports only, not individual symbol uses, and says so.
 */
export async function impactViaText(targetFile: string, deps: TextImpactDeps): Promise<ImpactReport> {
  const target = path.resolve(deps.root, targetFile);
  const targetBase = stripExt(target);
  const isJs = JS_EXT.test(target);
  const isPy = /\.pyi?$/i.test(target);
  const limitations = ["Text search finds files that import this module; it cannot tell which functions inside it they use, and it misses dynamic imports and re-exports through other packages."];
  if (!isJs && !isPy) {
    return { method: "text-search", target, referencingFiles: [], truncated: false, limitations: [...limitations, "Import scanning is only implemented for JavaScript/TypeScript and Python; install a language server for this language."] };
  }

  const files = (await deps.listFiles()).filter((f) => (isJs ? JS_EXT.test(f) : /\.pyi?$/i.test(f)));
  const results: FileReferences[] = [];
  let scanned = 0;
  const pyModule = isPy ? stripExt(path.relative(deps.root, target)).split(path.sep).join(".").replace(/\.__init__$/, "") : "";
  for (const rel of files) {
    if (scanned >= MAX_SCAN_FILES) break;
    const abs = path.resolve(deps.root, rel);
    if (abs === target) continue;
    const text = await deps.readText(abs);
    if (text === undefined || text.length > MAX_SCAN_BYTES) continue;
    scanned++;
    let hits = 0;
    if (isJs) {
      for (const m of text.matchAll(IMPORT_SPEC)) {
        const spec = m[1];
        if (!spec?.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(abs), spec);
        if (stripExt(resolved) === targetBase || resolved === targetBase || path.join(resolved, "index") === targetBase) hits++;
      }
    } else if (pyModule) {
      const escaped = pyModule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      hits = [...text.matchAll(new RegExp(`^\\s*(?:from\\s+${escaped}\\s+import|import\\s+${escaped})\\b`, "gm"))].length;
    }
    if (hits > 0) results.push({ file: abs, count: hits });
  }
  const truncated = files.length > MAX_SCAN_FILES;
  if (truncated) limitations.push(`Only the first ${MAX_SCAN_FILES} files were scanned.`);
  return { method: "text-search", target, referencingFiles: results.sort((a, b) => b.count - a.count), truncated, limitations };
}

import path from "node:path";
import { scanText } from "../security/scan.js";

export type CodeFamily = "js" | "python" | "go" | "rust" | "other";

export function familyOf(file: string): CodeFamily {
  const ext = path.extname(file).toLowerCase();
  if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "js";
  if ([".py", ".pyi"].includes(ext)) return "python";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "rust";
  return "other";
}

export interface CodeSymbol {
  kind: "function" | "class" | "interface" | "type" | "enum" | "struct" | "trait" | "impl" | "const";
  name: string;
  line: number;
  exported: boolean;
  params?: string;
}

export interface Metrics {
  codeLines: number;
  commentLines: number;
  functions: number;
  branches: number;
  maxNesting: number;
  asyncMarkers: number;
  advancedMarkers: number;
  score: number;
}

export interface RiskFinding {
  id: string;
  line: number;
  severity: "high" | "medium" | "low";
  /** Plain-English description. Always phrased as "possible": a pattern match is not proof. */
  message: string;
}

export interface Analysis {
  file: string;
  family: CodeFamily;
  symbols: CodeSymbol[];
  imports: string[];
  metrics: Metrics;
  risks: RiskFinding[];
  /** Concepts a learner meets in this code, as glossary terms. */
  concepts: string[];
}

/** Blanks out string contents and comments so brace/branch counting is not fooled by them. */
export function stripNonCode(text: string, family: CodeFamily): string {
  let out = "";
  let i = 0;
  const hash = family === "python";
  const slash = family !== "python";
  while (i < text.length) {
    const c = text[i] ?? "";
    const n = text[i + 1] ?? "";
    if (slash && c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (slash && c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) out += text[i++] === "\n" ? "\n" : " ";
      i += 2;
    } else if (hash && c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === '"' || c === "'" || (c === "`" && family !== "python")) {
      const triple = hash && text.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      out += quote;
      i += quote.length;
      while (i < text.length && !text.startsWith(quote, i)) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (!triple && c !== "`" && text[i] === "\n") break;
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += quote;
      i += quote.length;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const SYMBOL_PATTERNS: Record<CodeFamily, ReadonlyArray<{ kind: CodeSymbol["kind"]; re: RegExp; exported?: (m: RegExpExecArray) => boolean }>> = {
  js: [
    { kind: "function", re: /^[ \t]*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(([^)]*)\)/ },
    { kind: "class", re: /^[ \t]*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: "interface", re: /^[ \t]*(export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: "type", re: /^[ \t]*(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/ },
    { kind: "enum", re: /^[ \t]*(export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function", re: /^[ \t]*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>/ },
  ],
  python: [
    { kind: "function", re: /^()(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, exported: (m) => !(m[2] ?? "").startsWith("_") },
    { kind: "class", re: /^()class\s+([A-Za-z_]\w*)/, exported: (m) => !(m[2] ?? "").startsWith("_") },
  ],
  go: [
    { kind: "function", re: /^()func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/, exported: (m) => /^[A-Z]/.test(m[2] ?? "") },
    { kind: "struct", re: /^()type\s+([A-Za-z_]\w*)\s+struct\b/, exported: (m) => /^[A-Z]/.test(m[2] ?? "") },
    { kind: "interface", re: /^()type\s+([A-Za-z_]\w*)\s+interface\b/, exported: (m) => /^[A-Z]/.test(m[2] ?? "") },
  ],
  rust: [
    { kind: "function", re: /^[ \t]*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\(([^)]*)\)/ },
    { kind: "struct", re: /^[ \t]*(pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/ },
    { kind: "enum", re: /^[ \t]*(pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/ },
    { kind: "trait", re: /^[ \t]*(pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/ },
    { kind: "impl", re: /^()[ \t]*impl(?:<[^>]*>)?\s+([A-Za-z_][\w:<>, ]*)/ },
  ],
  other: [],
};

/** Declarations found by pattern matching (not a real parser). Class members are not listed. */
export function extractSymbols(content: string, family: CodeFamily): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const seen = new Set<string>();
  content.split(/\r?\n/).forEach((line, i) => {
    for (const { kind, re, exported } of SYMBOL_PATTERNS[family]) {
      const m = re.exec(line);
      if (!m?.[2]) continue;
      const key = `${kind}:${m[2]}:${i}`;
      if (seen.has(key)) break;
      seen.add(key);
      symbols.push({
        kind,
        name: m[2].trim(),
        line: i + 1,
        exported: exported ? exported(m) : Boolean(m[1]),
        ...(m[3] !== undefined ? { params: m[3].trim() } : {}),
      });
      break;
    }
  });
  return symbols;
}

export function extractImports(content: string, family: CodeFamily): string[] {
  const found = new Set<string>();
  const add = (s: string | undefined): void => {
    if (s) found.add(s);
  };
  if (family === "js") {
    for (const m of content.matchAll(/(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) add(m[1]);
  } else if (family === "python") {
    for (const m of content.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) add(m[1]);
    for (const m of content.matchAll(/^\s*import\s+([\w.]+)/gm)) add(m[1]);
  } else if (family === "rust") {
    for (const m of content.matchAll(/^\s*use\s+([\w:]+)/gm)) add(m[1]);
  } else if (family === "go") {
    for (const block of content.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) for (const m of (block[1] ?? "").matchAll(/"([^"]+)"/g)) add(m[1]);
    for (const m of content.matchAll(/^import\s+"([^"]+)"/gm)) add(m[1]);
  }
  return [...found];
}

const BRANCH = /\b(if|else\s+if|elif|for|while|switch|case|catch|except|match)\b|&&|\|\||\?\?|[^?]\?(?=[^?.:])/g;
const ASYNC = /\b(async|await|Promise|setTimeout|setInterval|asyncio|goroutine|tokio|spawn|thread|Thread)\b|\bgo\s+func\b|\.then\s*\(|\bchan\b|<-/g;
const ADVANCED = /\bgeneric\b|<[A-Z]\w*(?:\s+extends\b[^>]*)?>|\bunsafe\b|\byield\b|\blambda\b|\bwith\s+\w+.*:|\bReflect\.|\bProxy\b|\bSymbol\b|\bunion\b|\bkeyof\b|\bas\s+const\b|\bwhere\s+\w+:|\b'[a-z]\b|\bdecorator\b|@\w+\s*\(/g;

function measure(content: string, family: CodeFamily, symbols: readonly CodeSymbol[]): Metrics {
  const lines = content.split(/\r?\n/);
  const code = stripNonCode(content, family);
  const codeLinesArr = code.split(/\r?\n/);
  const codeLines = codeLinesArr.filter((l) => l.trim() !== "").length;
  const commentLines = lines.filter((l) => /^\s*(\/\/|#|\*|\/\*)/.test(l)).length;

  let maxNesting = 0;
  if (family === "python") {
    for (const l of codeLinesArr) {
      if (l.trim() === "") continue;
      const indent = /^[ \t]*/.exec(l)?.[0].replace(/\t/g, "    ").length ?? 0;
      maxNesting = Math.max(maxNesting, Math.floor(indent / 4));
    }
  } else {
    let depth = 0;
    for (const ch of code) {
      if (ch === "{") maxNesting = Math.max(maxNesting, ++depth);
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }

  const branches = (code.match(BRANCH) ?? []).length;
  const asyncMarkers = (code.match(ASYNC) ?? []).length;
  const advancedMarkers = (code.match(ADVANCED) ?? []).length;
  const functions = symbols.filter((s) => s.kind === "function").length;
  const score = Math.round((codeLines / 20 + branches * 0.8 + maxNesting * 3 + asyncMarkers * 1.5 + functions * 0.5 + advancedMarkers * 2) * 10) / 10;
  return { codeLines, commentLines, functions, branches, maxNesting, asyncMarkers, advancedMarkers, score };
}

interface RiskRule {
  id: string;
  families: readonly CodeFamily[];
  severity: RiskFinding["severity"];
  re: RegExp;
  message: string;
}

const RISK_RULES: readonly RiskRule[] = [
  { id: "dynamic-eval", families: ["js", "python"], severity: "high", re: /\beval\s*\(|\bnew\s+Function\s*\(|(?<![.\w$])exec\s*\(\s*[A-Za-z_]|\b(?:child_process|childProcess|cp)\.exec\s*\(\s*[A-Za-z_]/, message: "Possible dynamic code execution (eval/exec): if any part of the text comes from a user, they could run their own code." },
  { id: "html-injection", families: ["js"], severity: "medium", re: /\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(/, message: "Possible HTML injection point: inserting text as HTML can let outside text run as script (XSS)." },
  { id: "shell-from-string", families: ["js", "python"], severity: "high", re: /\b(?:exec|execSync|spawn|system|popen)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)|shell\s*=\s*True/, message: "Possible shell command built from text or run through a shell: unsafe input could add its own commands (command injection)." },
  { id: "sql-from-string", families: ["js", "python", "go", "rust"], severity: "high", re: /\b(select|insert\s+into|update|delete\s+from)\b[^\n]*(\$\{|["']\s*\+\s*\w|%s|\bformat!?\s*\(|\bf["'])/i, message: "Possible SQL built by pasting text together: unsafe input could change the query (SQL injection). Parameterised queries avoid this." },
  { id: "swallowed-error", families: ["js"], severity: "medium", re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, message: "An error is caught and silently ignored, so failures here would be invisible." },
  { id: "swallowed-error-py", families: ["python"], severity: "medium", re: /except[^\n]*:\s*(?:pass\b|\n\s+pass\b)/, message: "An error is caught and silently ignored (except ... pass), so failures here would be invisible." },
  { id: "unsafe-deserialize", families: ["python"], severity: "high", re: /\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader)/, message: "Possible unsafe loading of untrusted data (pickle / yaml.load): crafted input can run code." },
  { id: "any-type", families: ["js"], severity: "low", re: /:\s*any\b|\bas\s+any\b/, message: "The `any` type switches off type checking for this value, so mistakes here would not be caught." },
  { id: "unwrap", families: ["rust"], severity: "low", re: /\.unwrap\(\)|\.expect\(/, message: "unwrap/expect crashes the program if the value is missing or an error; fine in tests, risky in production paths." },
  { id: "unsafe-block", families: ["rust"], severity: "medium", re: /\bunsafe\s*\{/, message: "An unsafe block turns off some of Rust's safety checks; the programmer is responsible for keeping it correct." },
  { id: "ignored-error", families: ["go"], severity: "medium", re: /,\s*_\s*:?=\s*\w+[\w.]*\(/, message: "A returned value (possibly an error) is thrown away with `_`; a failure here would go unnoticed." },
  { id: "todo-marker", families: ["js", "python", "go", "rust", "other"], severity: "low", re: /\b(TODO|FIXME|HACK|XXX)\b/, message: "A note left in the code marks unfinished or questionable work." },
];

function findRisks(content: string, family: CodeFamily, file: string): RiskFinding[] {
  const risks: RiskFinding[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RISK_RULES) {
      if (rule.families.includes(family) && rule.re.test(line)) risks.push({ id: rule.id, line: i + 1, severity: rule.severity, message: rule.message });
    }
  });
  // Multi-line python `except: <newline> pass` is handled on the joined text.
  if (family === "python") {
    for (const m of content.matchAll(/except[^\n]*:\s*\n\s+pass\b/g)) {
      const line = content.slice(0, m.index ?? 0).split("\n").length;
      if (!risks.some((r) => r.id === "swallowed-error-py" && r.line === line)) risks.push({ id: "swallowed-error-py", line, severity: "medium", message: RISK_RULES.find((r) => r.id === "swallowed-error-py")?.message ?? "" });
    }
  }
  for (const f of scanText(content, file)) {
    risks.push({ id: `secret:${f.rule}`, line: f.line, severity: "high", message: "Something that looks like a hard-coded credential is in the source. Secrets belong in environment variables or a secret store." });
  }
  return risks.sort((a, b) => a.line - b.line);
}

const CONCEPT_HINTS: ReadonlyArray<{ term: string; re: RegExp }> = [
  { term: "async/await", re: /\basync\b|\bawait\b|\basyncio\b/ },
  { term: "promise", re: /\bPromise\b|\.then\s*\(/ },
  { term: "callback", re: /\bcallback\b|\bcb\)|=>\s*\{[^}]*\}\s*\)/ },
  { term: "recursion", re: /./ }, // resolved specially below
  { term: "generics", re: /<[A-Z]\w*(?:\s+extends\b[^>]*)?>|\[T\b|<T>/ },
  { term: "regex", re: /\/[^/\n]+\/[gimsuy]*\.test\(|\bre\.(?:compile|match|search|sub)\b|new RegExp\(|Regex::new/ },
  { term: "closure", re: /return\s+(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|return\s+function\b/ },
  { term: "dependency injection", re: /\bdeps\b|\binject\b|constructor\s*\(\s*(?:private|public|readonly)\b/ },
  { term: "transaction", re: /\btransaction\b|\bBEGIN\b|\bCOMMIT\b/i },
  { term: "optional chaining", re: /\?\./ },
  { term: "destructuring", re: /\b(?:const|let|var)\s*[{[][^=]*\]?\}?\s*=/ },
  { term: "exception", re: /\btry\b[\s\S]{0,400}\b(catch|except)\b|\braise\b|\bthrow\b/ },
];

function isRecursive(symbols: readonly CodeSymbol[], content: string): boolean {
  const lines = content.split(/\r?\n/);
  return symbols.some((s, idx) => {
    if (s.kind !== "function") return false;
    const name = s.name.replace(ESCAPE, "\\$&");
    const next = symbols[idx + 1]?.line ?? lines.length + 1;
    const region = lines.slice(s.line - 1, next - 1).join("\n");
    const calls = [...region.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g"))].length;
    // A `function name(` / `def name(` declaration line contains one call-shaped match of its own.
    const declaresItself = new RegExp(`\\b(?:function|def|fn|func)\\s+\\*?\\s*${name}\\s*\\(`).test(lines[s.line - 1] ?? "");
    return calls - (declaresItself ? 1 : 0) > 0;
  });
}
const ESCAPE = /[.*+?^${}()|[\]\\]/g;

export function analyzeCode(file: string, content: string): Analysis {
  const family = familyOf(file);
  const symbols = extractSymbols(content, family);
  const code = stripNonCode(content, family);
  const concepts = CONCEPT_HINTS.filter(({ term, re }) => (term === "recursion" ? isRecursive(symbols, code) : re.test(code))).map((c) => c.term);
  return { file, family, symbols, imports: extractImports(content, family), metrics: measure(content, family, symbols), risks: findRisks(content, family, file), concepts };
}

export type Depth = "brief" | "standard" | "deep";

/** Adaptive depth: simple code gets a short explanation, intricate code gets a thorough one. */
export function chooseDepth(setting: "adaptive" | Depth, metrics: Metrics): Depth {
  if (setting !== "adaptive") return setting;
  if (metrics.score < 12) return "brief";
  if (metrics.score < 40) return "standard";
  return "deep";
}

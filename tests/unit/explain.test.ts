import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.js";
import { analyzeCode, chooseDepth, extractImports, extractSymbols, stripNonCode } from "../../src/explain/analyze.js";
import { buildChangeBriefing, buildErrorBriefing, buildFileBriefing } from "../../src/explain/briefing.js";
import { summarizeChange } from "../../src/explain/diff.js";
import { explainError } from "../../src/explain/errors.js";
import { GLOSSARY, findJargon, lookupTerm, plainPhrase } from "../../src/explain/glossary.js";

const cfg = () => defaultConfig().explanation;

const SIMPLE = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
const COMPLEX = `import { db } from "./db";
import fs from "node:fs";
export class Repo<T extends object> {
  async load(ids: string[]): Promise<T[]> {
    const out: T[] = [];
    for (const id of ids) {
      if (id) {
        try {
          const row = await db.query(\`select * from items where id = \${id}\`);
          if (row && row.ok) {
            for (const part of row.parts) {
              while (part.next) {
                if (part.skip || part.hidden) { continue; }
                out.push(part as unknown as T);
              }
            }
          }
        } catch (e) {}
      }
    }
    return out;
  }
}
export const walk = (n: number): number => (n <= 0 ? 0 : n + walk(n - 1));
export async function a1() { await 1; }
export async function a2() { await 1; }
const token = "sk-abcdefghijklmnop1234";
`;

describe("glossary", () => {
  it("every entry has the real term, a plain meaning and a phrase that keeps the term in parentheses", () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(70);
    const terms = new Set<string>();
    for (const e of GLOSSARY) {
      expect(e.plain.length, e.term).toBeGreaterThan(20);
      expect(e.phrase, e.term).toMatch(/\([^)]+\)$/);
      expect(terms.has(e.term.toLowerCase()), `duplicate ${e.term}`).toBe(false);
      terms.add(e.term.toLowerCase());
    }
  });
  it("finds terms and aliases on word boundaries only", () => {
    const hits = findJargon("We await the Promise, then cache it. Our indexing is fine; the CORS config and a hash map help.").map((e) => e.term);
    expect(hits).toEqual(expect.arrayContaining(["async/await", "promise", "cache", "CORS", "hash map"]));
    expect(hits).not.toContain("index"); // "indexing" is not the whole word
    expect(findJargon("nothing technical here")).toEqual([]);
  });
  it("looks up by alias and falls back to the raw term", () => {
    expect(lookupTerm("Dictionary")?.term).toBe("hash map");
    expect(plainPhrase("closure")).toContain("(closure)");
    expect(plainPhrase("unknown-thing")).toBe("unknown-thing");
  });
});

describe("static analysis", () => {
  it("ignores braces and keywords inside strings and comments", () => {
    const stripped = stripNonCode('const s = "if { while"; // for { if\n/* switch { */ let x = 1;', "js");
    expect(stripped).not.toMatch(/if|while|for|switch/);
    expect(stripped).toContain("let x = 1;");
    const py = stripNonCode('x = """if for\nwhile"""  # if', "python");
    expect(py).not.toMatch(/\bif\b|\bfor\b|\bwhile\b/);
  });

  it("extracts declarations and imports across languages", () => {
    const names = (src: string, fam: Parameters<typeof extractSymbols>[1]) => extractSymbols(src, fam).map((s) => `${s.kind}:${s.name}:${s.exported}`);
    expect(names(COMPLEX, "js")).toEqual(expect.arrayContaining(["class:Repo:true", "function:walk:true", "function:a1:true"]));
    expect(names("def a(x):\n  pass\nclass _B: pass\nasync def c(): pass", "python")).toEqual(["function:a:true", "class:_B:false", "function:c:true"]);
    expect(names("func Run(a int) {}\nfunc helper() {}\ntype S struct {}", "go")).toEqual(["function:Run:true", "function:helper:false", "struct:S:true"]);
    expect(names("pub fn go() {}\nfn hid() {}\npub struct P;", "rust")).toEqual(["function:go:true", "function:hid:false", "struct:P:true"]);
    expect(extractImports(COMPLEX, "js")).toEqual(["./db", "node:fs"]);
    expect(extractImports("import os\nfrom a.b import c", "python").sort()).toEqual(["a.b", "os"]);
    expect(extractImports('import (\n "fmt"\n "os"\n)', "go")).toEqual(["fmt", "os"]);
  });

  it("scores simple code low and intricate code high, and picks depth from the score", () => {
    const simple = analyzeCode("a.ts", SIMPLE);
    const complex = analyzeCode("c.ts", COMPLEX);
    expect(simple.metrics.score).toBeLessThan(12);
    expect(complex.metrics.score).toBeGreaterThan(simple.metrics.score * 3);
    expect(chooseDepth("adaptive", simple.metrics)).toBe("brief");
    expect(chooseDepth("adaptive", { ...complex.metrics, score: 55 })).toBe("deep");
    expect(chooseDepth("deep", simple.metrics)).toBe("deep");
    expect(complex.metrics.maxNesting).toBeGreaterThanOrEqual(7);
  });

  it("flags risk patterns as possible issues with line numbers, without echoing secrets", () => {
    const risks = analyzeCode("c.ts", COMPLEX).risks;
    const ids = risks.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["sql-from-string", "swallowed-error", "secret:anthropic-or-openai-key"]));
    expect(risks.find((r) => r.id === "swallowed-error")?.line).toBe(18);
    expect(JSON.stringify(risks)).not.toContain("abcdefghijklmnop1234");
    expect(analyzeCode("a.ts", SIMPLE).risks).toEqual([]);
  });

  it("does not mistake a regular expression's exec() for dynamic code execution, but still flags the real thing", () => {
    const flagged = (code: string, file = "a.ts"): boolean => analyzeCode(file, code).risks.some((r) => r.id === "dynamic-eval");
    // Common, harmless: matching a pattern against text.
    for (const harmless of ["const m = /a+/.exec(text);", "const hit = PATTERN.exec(line);", "while ((m = re.exec(s)) !== null) {}", "const x = this.regex.exec(input)"]) expect(flagged(harmless), harmless).toBe(false);
    // Real: running text as code, in the forms JavaScript and Python use.
    expect(flagged("eval(userInput)")).toBe(true);
    expect(flagged("const f = new Function(body)")).toBe(true);
    expect(flagged("exec(command)")).toBe(true);
    expect(flagged("cp.exec(command)")).toBe(true);
    expect(flagged("child_process.exec(cmd)")).toBe(true);
    expect(flagged("exec(code)", "a.py")).toBe(true);
  });

  it("flags python and rust specific patterns and multi-line swallowed errors", () => {
    expect(analyzeCode("a.py", "try:\n  x()\nexcept Exception:\n  pass\nimport pickle\npickle.loads(d)\n").risks.map((r) => r.id)).toEqual(expect.arrayContaining(["swallowed-error-py", "unsafe-deserialize"]));
    expect(analyzeCode("a.rs", "fn f() { let v = g().unwrap(); unsafe { h() } }").risks.map((r) => r.id)).toEqual(expect.arrayContaining(["unwrap", "unsafe-block"]));
  });

  it("detects teachable concepts including recursion", () => {
    const concepts = analyzeCode("c.ts", COMPLEX).concepts;
    expect(concepts).toEqual(expect.arrayContaining(["async/await", "generics", "recursion", "exception"]));
    expect(analyzeCode("a.ts", SIMPLE).concepts).not.toContain("recursion");
  });
});

describe("error explanations", () => {
  it.each([
    ["src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.", "ts2322"],
    ["TypeError: Cannot read properties of undefined (reading 'name')", "js-undefined-property"],
    ["Error: listen EADDRINUSE: address already in use :::3000", "eaddrinuse"],
    ["error[E0382]: borrow of moved value: `v`", "rust-e0382"],
    ["./main.go:9:2: declared and not used: x", "go-unused"],
    ["AttributeError: 'NoneType' object has no attribute 'get'", "py-nonetype"],
    ["RangeError: Maximum call stack size exceeded", "stack-overflow"],
  ])("recognises %s", (message, id) => {
    expect(explainError(message).map((e) => e.id)).toContain(id);
  });
  it("returns nothing for unknown messages and every teachable term exists in the glossary", () => {
    expect(explainError("flux capacitor desynchronised")).toEqual([]);
    for (const m of ["TS2322", "TS2339", "TypeError: Cannot read properties of undefined", "E0499", "stack overflow", "heap out of memory"]) {
      for (const e of explainError(m)) for (const t of e.terms) expect(lookupTerm(t), `${e.id} -> ${t}`).toBeDefined();
    }
  });
});

describe("summarizeChange", () => {
  const before = "function a() {\n  return 1;\n}\nconst keep = 1;\n";
  const after = "function a() {\n  return 2;\n}\nfunction b() {\n  eval(x);\n}\nconst keep = 1;\n";
  it("computes line changes, hunks, declarations and risks gained", () => {
    const s = summarizeChange("f.js", before, after);
    expect(s).toMatchObject({ added: 4, removed: 1, approximate: false });
    expect(s.hunks[0]).toMatchObject({ beforeStart: 2, removed: ["  return 1;"] });
    expect(s.symbolsAdded).toEqual(["function b"]);
    expect(s.symbolsRemoved).toEqual([]);
    expect(s.risksIntroduced.map((r) => r.id)).toEqual(["dynamic-eval"]);
    expect(summarizeChange("f.js", after, before).risksResolved.map((r) => r.id)).toEqual(["dynamic-eval"]);
  });
  it("handles identical and huge inputs", () => {
    expect(summarizeChange("f.js", before, before)).toMatchObject({ added: 0, removed: 0, hunks: [] });
    const big = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
    const approx = summarizeChange("f.js", big, `${big}\nextra`);
    expect(approx.approximate).toBe(true);
    expect(approx.added).toBe(1);
  });
});

describe("briefings", () => {
  it("adapts depth and required sections to the code and the settings", () => {
    const simple = buildFileBriefing({ file: "a.ts", content: SIMPLE }, cfg());
    expect(simple.depth).toBe("brief");
    expect(simple.required).toEqual(["what", "why", "how"]);
    const deep = buildFileBriefing({ file: "c.ts", content: COMPLEX, dependents: ["x.ts", "y.ts"], phase: "after" }, { ...cfg(), depth: "deep" });
    expect(deep.required).toEqual(["what", "why", "how", "where-used", "inputs", "outputs", "dependents", "risks", "concepts", "examples"]);
    expect(deep.text).toContain("Files that import this one: x.ts, y.ts");
    expect(deep.text).toContain("Possible risks");
  });

  it("honours the explanation settings", () => {
    const base = { file: "c.ts", content: COMPLEX, dependents: ["x.ts"] };
    const noTeach = buildFileBriefing(base, { ...cfg(), depth: "deep", teachConcepts: false, examples: "never" });
    expect(noTeach.required).not.toContain("concepts");
    expect(noTeach.required).not.toContain("examples");
    expect(noTeach.text).toContain("Do not add concept lessons");
    const always = buildFileBriefing({ file: "a.ts", content: SIMPLE }, { ...cfg(), examples: "always" });
    expect(always.required).toContain("examples");
    const noJargon = buildFileBriefing({ file: "c.ts", content: COMPLEX }, { ...cfg(), translateJargon: false });
    expect(noJargon.text).not.toContain("Plain-English glossary");
    const withJargon = buildFileBriefing({ file: "c.ts", content: COMPLEX }, cfg());
    expect(withJargon.text).toContain("Plain-English glossary");
    expect(withJargon.text).toContain("(async/await)");
    expect(buildFileBriefing({ file: "a.ts", content: SIMPLE }, { ...cfg(), format: "prose" }).text).toContain("flowing prose");
  });

  it("is honest about what it extracted and the phase, and omits secrets", () => {
    const b = buildFileBriefing({ file: "c.ts", content: COMPLEX, phase: "before" }, cfg());
    expect(b.text).toContain("before coding");
    expect(b.text).toContain("pattern matching, not a full parser");
    expect(b.text).not.toContain("abcdefghijklmnop1234");
  });

  it("marks unsupported languages as limited", () => {
    expect(buildFileBriefing({ file: "a.zig", content: "const x = 1;" }, cfg()).text).toContain("language not specifically supported");
  });

  it("builds change and error briefings from real facts", () => {
    const change = buildChangeBriefing(summarizeChange("f.js", "a\n", "a\nb\neval(x)\n"), cfg());
    expect(change.text).toContain("+2 / -0");
    expect(change.text).toContain("New possible risks");
    const err = buildErrorBriefing("TypeError: Cannot read properties of undefined (reading 'x')", cfg());
    expect(err.text).toContain("Usual fix");
    expect(err.text).toContain("optional chaining");
    expect(buildErrorBriefing("weird", cfg()).text).toContain("No built-in explanation matched");
  });
});

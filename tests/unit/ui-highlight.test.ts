import { describe, expect, it } from "vitest";
import { lineText, type Line } from "../../src/ui/doc.js";
import { highlight, languageFor, MAX_HIGHLIGHT_LINE, type Language } from "../../src/ui/highlight.js";

const LANGUAGES: readonly Language[] = ["js", "python", "go", "rust", "json", "plain"];

/** (text, role) for each non-plain span, so tests read like the highlighting they check. */
const marks = (lines: readonly Line[]): Array<[string, string]> => lines.flatMap((l) => l.filter((s) => s.role !== undefined).map((s): [string, string] => [s.text, s.role ?? ""]));

describe("languageFor", () => {
  it.each([
    ["a.ts", "js"], ["a.tsx", "js"], ["a.mjs", "js"], ["a.cjs", "js"], ["src/app.JS", "js"],
    ["a.py", "python"], ["a.go", "go"], ["a.rs", "rust"], ["package.json", "json"], ["tsconfig.jsonc", "json"],
    ["README.md", "plain"], ["Makefile", "plain"], ["a.", "plain"], ["", "plain"], ["archive.tar.gz", "plain"],
  ])("%s is %s", (file, language) => {
    expect(languageFor(file)).toBe(language);
  });
});

describe("highlight: what is coloured", () => {
  it("marks keywords, strings, numbers and comments in TypeScript, and leaves the rest plain", () => {
    expect(marks(highlight('const x = 42; // the answer\nreturn "hi";', "js"))).toEqual([
      ["const", "keyword"], ["42", "number"], ["// the answer", "comment"], ["return", "keyword"], ['"hi"', "string"],
    ]);
  });
  it("does not colour a keyword inside a longer word or inside a string or comment", () => {
    expect(marks(highlight("constant returnValue", "js"))).toEqual([]);
    expect(marks(highlight('"if else" /* while */', "js"))).toEqual([['"if else"', "string"], ["/* while */", "comment"]]);
  });
  it("handles escaped quotes and numbers in many forms", () => {
    expect(marks(highlight('"a \\" still string" 0xFF 1_000 3.14e-2 .5', "js"))).toEqual([['"a \\" still string"', "string"], ["0xFF", "number"], ["1_000", "number"], ["3.14e-2", "number"], ["5", "number"]]);
  });
  it("carries block comments and template strings across lines", () => {
    const lines = highlight("/* one\ntwo\nthree */ x\n`a\nb` y", "js");
    expect(marks(lines)).toEqual([["/* one", "comment"], ["two", "comment"], ["three */", "comment"], ["`a", "string"], ["b`", "string"]]);
  });
  it("highlights Python: hash comments, triple-quoted strings across lines, None/True", () => {
    expect(marks(highlight('def f(x):  # note\n    """doc\n    more"""\n    return None', "python"))).toEqual([
      ["def", "keyword"], ["# note", "comment"], ['"""doc', "string"], ['    more"""', "string"], ["return", "keyword"], ["None", "keyword"],
    ]);
  });
  it("highlights Go, including raw strings", () => {
    expect(marks(highlight("func main() {\n\ts := `raw`\n}", "go")).map(([t]) => t)).toEqual(["func", "`raw`"]);
  });
  it("highlights Rust, and treats a lifetime as plain rather than the start of a string", () => {
    expect(marks(highlight("fn f<'a>(x: &'a str) -> &'a str { x }", "rust"))).toEqual([["fn", "keyword"]]);
    expect(marks(highlight("let c = 'x'; let s = \"y\";", "rust"))).toEqual([["let", "keyword"], ["'x'", "string"], ["let", "keyword"], ['"y"', "string"]]);
  });
  it("highlights JSON values and leaves braces plain", () => {
    expect(marks(highlight('{ "a": [1, true, null] }', "json")).map(([t]) => t)).toEqual(['"a"', "1", "true", "null"]);
  });
  it("leaves plain text completely plain", () => {
    expect(marks(highlight("const x = 'y' // z", "plain"))).toEqual([]);
  });
  it("shows a very long line plain, so a minified file cannot make highlighting slow", () => {
    const long = `const a = "${"x".repeat(MAX_HIGHLIGHT_LINE)}";`;
    expect(marks(highlight(long, "js"))).toEqual([]);
  });
});

describe("highlight: it can never change the code", () => {
  const HOSTILE = [
    "", " ", "\t", "const", '"unterminated', "'", "`", "`unterminated\nnext line", "/* never closed", '"""never closed', "// only a comment",
    'a"b\'c`d', "\\", "\\\\\\", '"\\', "0x", "1e", "1.", "..", "$_$", "日本語 const 変数", "👨‍👩‍👧 = 1", "é", "\u0000\u001b[31m", "a\r\nb", "x".repeat(5000),
    "fn f<'a>(x: &'a str) {}\nlet s = 'unterminated", "{ \"a\": \"b\\\"c\" }\n]]]", "/* a */ /* b */ code /* c",
  ];

  it("joins every line's spans back to exactly that line, for every language and every awkward input", () => {
    for (const language of LANGUAGES) {
      for (const code of HOSTILE) {
        const lines = highlight(code, language);
        expect(lines.map(lineText).join("\n"), `${language}: ${JSON.stringify(code.slice(0, 40))}`).toBe(code);
        expect(lines).toHaveLength(code.split("\n").length);
      }
    }
  });
  it("is lossless on this project's own source files in every language it understands", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const [file, language] of [["src/ui/highlight.ts", "js"], ["package.json", "json"], ["tests/unit/ui-highlight.test.ts", "js"]] as const) {
      const code = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
      expect(highlight(code, language).map(lineText).join("\n"), file).toBe(code);
    }
  });
  it("never creates an empty span, so nothing is drawn that is not code", () => {
    for (const language of LANGUAGES) for (const code of HOSTILE) for (const line of highlight(code, language)) for (const s of line) if (code !== "") expect(s.text.length, `${language}`).toBeGreaterThan(0);
  });
  it("merges neighbouring plain text into one span", () => {
    expect(highlight("a + b - c", "js")[0]).toHaveLength(1);
  });
  it("never throws on random input", () => {
    let seed = 99;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      return seed;
    };
    const alphabet = ["a", "b", "1", " ", '"', "'", "`", "/", "*", "\\", "#", "\n", "{", "}", "0x", "·", "日", "\u0000"];
    for (let round = 0; round < 300; round++) {
      const code = Array.from({ length: next() % 60 }, () => alphabet[next() % alphabet.length]).join("");
      for (const language of LANGUAGES) expect(highlight(code, language).map(lineText).join("\n")).toBe(code);
    }
  });
});

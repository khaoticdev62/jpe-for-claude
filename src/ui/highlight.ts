/**
 * Syntax highlighting for the code JPE shows: keywords, strings, comments and numbers, for the languages JPE
 * understands. It is a small lexer, not a parser, so it is deliberately forgiving: whatever it does not recognise is
 * left plain, and an unfinished string or comment never breaks the lines that follow.
 *
 * The one hard guarantee, asserted by the tests for every language and for hostile input: the spans of each line
 * join back to exactly that line. Highlighting only colours code, it can never change or hide it.
 */

import { type Line, plain, span } from "./doc.js";
import type { SyntaxRole } from "./tokens.js";

export type Language = "js" | "python" | "go" | "rust" | "json" | "plain";

const EXTENSIONS: Readonly<Record<string, Language>> = {
  ts: "js", tsx: "js", mts: "js", cts: "js", js: "js", jsx: "js", mjs: "js", cjs: "js",
  py: "python", pyi: "python",
  go: "go",
  rs: "rust",
  json: "json", jsonc: "json",
};

/** The language to highlight a file as, from its extension. Anything else is plain. */
export function languageFor(file: string): Language {
  const dot = file.lastIndexOf(".");
  return dot === -1 ? "plain" : (EXTENSIONS[file.slice(dot + 1).toLowerCase()] ?? "plain");
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(" "));

const KEYWORDS: Readonly<Record<Language, ReadonlySet<string>>> = {
  js: words("const let var function return if else for while do switch case break continue class extends new this super import export from default async await try catch finally throw typeof instanceof in of interface type enum implements public private protected readonly static abstract null undefined true false void as satisfies keyof declare namespace yield delete"),
  python: words("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield async await None True False global nonlocal assert del match case"),
  go: words("func package import return if else for range switch case default break continue type struct interface map chan go defer select var const nil true false fallthrough goto"),
  rust: words("fn let mut pub struct enum impl trait use mod return if else for while loop match break continue as in ref self Self super crate const static async await move where true false unsafe dyn type"),
  json: words("true false null"),
  plain: new Set(),
};

interface Syntax {
  lineComment?: string;
  blockComment: boolean;
  /** Characters that open a one-line string. */
  quotes: string;
  /** Opens a string that may continue on later lines (JavaScript templates, Go raw strings). */
  multiLineQuote?: string;
  tripleQuotes: boolean;
}

const SYNTAX: Readonly<Record<Language, Syntax>> = {
  js: { lineComment: "//", blockComment: true, quotes: "\"'", multiLineQuote: "`", tripleQuotes: false },
  python: { lineComment: "#", blockComment: false, quotes: "\"'", tripleQuotes: true },
  go: { lineComment: "//", blockComment: true, quotes: "\"'", multiLineQuote: "`", tripleQuotes: false },
  rust: { lineComment: "//", blockComment: true, quotes: "\"", tripleQuotes: false },
  json: { blockComment: false, quotes: "\"", tripleQuotes: false },
  plain: { blockComment: false, quotes: "", tripleQuotes: false },
};

/** Lines longer than this are shown plain: a minified bundle must not make highlighting slow. */
export const MAX_HIGHLIGHT_LINE = 2000;

/** What a line starts inside of, carried from the previous line. */
type Carry = { kind: "none" } | { kind: "block" } | { kind: "multi"; close: string };

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;
const RUST_CHAR = /^'(?:\\.|[^\\'])'/;
const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/;

interface Piece {
  text: string;
  role?: SyntaxRole;
}

function pushPiece(pieces: Piece[], text: string, role?: SyntaxRole): void {
  if (text === "") return;
  const last = pieces.at(-1);
  if (last !== undefined && last.role === role) last.text += text;
  else pieces.push(role === undefined ? { text } : { text, role });
}

/** Finds where a quoted string that opens at `start` ends (exclusive), or the end of the line if it does not close. */
function stringEnd(line: string, start: number, quote: string): { end: number; closed: boolean } {
  for (let i = start + 1; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === "\\") i++;
    else if (ch === quote) return { end: i + 1, closed: true };
  }
  return { end: line.length, closed: false };
}

function lexLine(line: string, language: Language, carry: Carry): { pieces: Piece[]; carry: Carry } {
  const syntax = SYNTAX[language];
  const keywords = KEYWORDS[language];
  const pieces: Piece[] = [];
  let i = 0;
  let state = carry;

  if (state.kind === "block") {
    const close = line.indexOf("*/");
    if (close === -1) return { pieces: [{ text: line, role: "comment" }], carry: state };
    pushPiece(pieces, line.slice(0, close + 2), "comment");
    i = close + 2;
    state = { kind: "none" };
  } else if (state.kind === "multi") {
    const close = line.indexOf(state.close);
    if (close === -1) return { pieces: [{ text: line, role: "string" }], carry: state };
    pushPiece(pieces, line.slice(0, close + state.close.length), "string");
    i = close + state.close.length;
    state = { kind: "none" };
  }

  while (i < line.length) {
    const ch = line.charAt(i);
    const rest = line.slice(i);

    if (syntax.lineComment !== undefined && rest.startsWith(syntax.lineComment)) {
      pushPiece(pieces, rest, "comment");
      break;
    }
    if (syntax.blockComment && rest.startsWith("/*")) {
      const close = line.indexOf("*/", i + 2);
      if (close === -1) {
        pushPiece(pieces, rest, "comment");
        return { pieces, carry: { kind: "block" } };
      }
      pushPiece(pieces, line.slice(i, close + 2), "comment");
      i = close + 2;
      continue;
    }
    if (syntax.tripleQuotes && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const quote = rest.slice(0, 3);
      const close = line.indexOf(quote, i + 3);
      if (close === -1) {
        pushPiece(pieces, rest, "string");
        return { pieces, carry: { kind: "multi", close: quote } };
      }
      pushPiece(pieces, line.slice(i, close + 3), "string");
      i = close + 3;
      continue;
    }
    if (syntax.multiLineQuote !== undefined && ch === syntax.multiLineQuote) {
      const close = line.indexOf(ch, i + 1);
      if (close === -1) {
        pushPiece(pieces, rest, "string");
        return { pieces, carry: { kind: "multi", close: ch } };
      }
      pushPiece(pieces, line.slice(i, close + 1), "string");
      i = close + 1;
      continue;
    }
    if (language === "rust" && ch === "'") {
      // A lone ' in Rust starts a lifetime ('a), not a string. Only a complete character literal ('x', '\n') is one.
      const literal = RUST_CHAR.exec(rest);
      if (literal !== null) {
        pushPiece(pieces, literal[0], "string");
        i += literal[0].length;
        continue;
      }
    }
    if (syntax.quotes.includes(ch)) {
      const { end } = stringEnd(line, i, ch);
      pushPiece(pieces, line.slice(i, end), "string");
      i = end;
      continue;
    }
    const previous = i === 0 ? "" : line.charAt(i - 1);
    if (/\d/.test(ch) && !IDENT_PART.test(previous)) {
      const match = NUMBER.exec(rest);
      if (match !== null) {
        pushPiece(pieces, match[0], "number");
        i += match[0].length;
        continue;
      }
    }
    if (IDENT_START.test(ch)) {
      let end = i + 1;
      while (end < line.length && IDENT_PART.test(line.charAt(end))) end++;
      const word = line.slice(i, end);
      pushPiece(pieces, word, keywords.has(word) ? "keyword" : undefined);
      i = end;
      continue;
    }
    pushPiece(pieces, ch);
    i++;
  }
  return { pieces, carry: state };
}

/**
 * One line of spans per line of `code` (split on \n), carrying multi-line comments and strings from line to line.
 * Lossless: joining the spans of a returned line gives back exactly that line.
 */
export function highlight(code: string, language: Language): Line[] {
  const lines = code.split("\n");
  if (language === "plain") return lines.map((line) => plain(line));
  let carry: Carry = { kind: "none" };
  return lines.map((line): Line => {
    if (line.length > MAX_HIGHLIGHT_LINE) return plain(line);
    const result = lexLine(line, language, carry);
    carry = result.carry;
    return result.pieces.length === 0 ? plain(line) : result.pieces.map((p) => (p.role === undefined ? span(p.text) : span(p.text, { role: p.role })));
  });
}

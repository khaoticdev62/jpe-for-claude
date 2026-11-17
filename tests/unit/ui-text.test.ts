import { describe, expect, it } from "vitest";
import { displayWidth, graphemes, inline, pad, sanitize, stripAnsi, truncate, wrapText } from "../../src/ui/text.js";

const ESC = "\u001b";
const BEL = "\u0007";

describe("sanitize: untrusted text can never drive the terminal", () => {
  it.each([
    ["colour codes", `${ESC}[31mred${ESC}[0m text`, "red text"],
    ["cursor movement and screen clearing", `${ESC}[2J${ESC}[Hfake prompt`, "fake prompt"],
    ["a window-title change ended by BEL", `${ESC}]0;pwned${BEL}hello`, "hello"],
    ["a window-title change ended by ST", `${ESC}]0;pwned${ESC}\\hello`, "hello"],
    ["an unterminated title change", `before${ESC}]0;never ends`, "before"],
    ["a hyperlink wrapper (OSC 8) keeps the visible text", `ok${ESC}]8;;http://evil.example${BEL}link${ESC}]8;;${BEL}`, "oklink"],
    ["a device-control string", `a${ESC}Pq#0;2;0;0;0${ESC}\\b`, "ab"],
    ["a terminal reset (ESC c)", `a${ESC}cb`, "ab"],
    ["a save-cursor escape (ESC 7)", `a${ESC}7b`, "ab"],
    ["a trailing escape character", `a${ESC}`, "a"],
    ["NUL and bell", `a\u0000b${BEL}c`, "abc"],
    ["backspace and DEL used to overwrite text", "safe\b\b\b\bfake\u007f", "safefake"],
    ["C1 control characters", "a\u0085b\u009bc", "abc"],
    ["bidirectional overrides that make text read backwards", "a‮b‪c⁦d⁩", "abcd"],
    ["left-to-right and right-to-left marks", "a‎b‏c؜d", "abcd"],
  ])("removes %s", (_name, input, expected) => {
    expect(sanitize(input)).toBe(expected);
  });

  it("keeps newlines, turns tabs into two spaces and CRLF into LF", () => {
    expect(sanitize("a\tb\r\nc\rd")).toBe("a  b\nc\nd");
  });

  it("keeps real text in every script, emoji and accent untouched", () => {
    for (const text of ["héllo wörld", "日本語のテキスト", "مرحبا بالعالم", "שלום", "😀 👨‍👩‍👧 🇯🇵", "á", "$ npm test && echo done", "<b>html</b> & 'quotes'"]) {
      expect(sanitize(text), text).toBe(text);
    }
  });

  it("never leaves an escape character behind, whatever comes in", () => {
    const pieces = [ESC, "[", "]", "P", "\\", "0", ";", "m", BEL, "x", "\u009b", "\u001b[31m", "\u001b]0;t\u0007"];
    for (const a of pieces) for (const b of pieces) for (const c of pieces) expect(sanitize(a + b + c), JSON.stringify(a + b + c)).not.toContain(ESC);
  });

  it("is idempotent", () => {
    const hostile = `${ESC}[31mred${ESC}]0;t${BEL} ‮done\tx`;
    expect(sanitize(sanitize(hostile))).toBe(sanitize(hostile));
  });
});

describe("inline", () => {
  it("sanitises and collapses line breaks to single spaces", () => {
    expect(inline(`one\n  two\r\nthree${ESC}[0m`)).toBe("one two three");
  });
});

describe("stripAnsi", () => {
  it("removes style sequences only", () => {
    expect(stripAnsi(`${ESC}[1;38;2;1;2;3mbold${ESC}[0m`)).toBe("bold");
  });
});

describe("displayWidth", () => {
  it.each([
    ["ascii", "hello", 5],
    ["empty", "", 0],
    ["precomposed accent", "é", 1],
    ["decomposed accent", "é", 1],
    ["CJK takes two columns each", "日本語", 6],
    ["Hangul", "한글", 4],
    ["full-width Latin", "ＡＢ", 4],
    ["emoji", "😀", 2],
    ["a family joined by zero-width joiners", "👨‍👩‍👧", 2],
    ["a flag (two regional indicators)", "🇯🇵", 2],
    ["a symbol with emoji presentation", "❤️", 2],
    ["mixed", "ab日c", 5],
    ["ANSI styling takes no room", `${ESC}[31mred${ESC}[0m`, 3],
    ["a combining mark alone", "́", 0],
    ["zero-width space", "a​b", 2],
  ])("%s", (_name, text, width) => {
    expect(displayWidth(text)).toBe(width);
  });
});

describe("graphemes", () => {
  it("keeps emoji sequences and accented letters whole", () => {
    expect(graphemes("👨‍👩‍👧a")).toEqual(["👨‍👩‍👧", "a"]);
    expect(graphemes("éx")).toEqual(["é", "x"]);
  });
});

describe("truncate", () => {
  it("leaves text that fits alone", () => {
    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("hello", 80)).toBe("hello");
  });
  it("cuts with an ellipsis and never exceeds the width", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(truncate("hello world", 8, "...")).toBe("hello...");
    expect(truncate("hello", 0)).toBe("");
    expect(truncate("hello", -3)).toBe("");
    expect(truncate("hello", 1)).toBe("…");
  });
  it("never exceeds the width for any mix of scripts", () => {
    const samples = ["hello world", "日本語のテキストです", "a👨‍👩‍👧b👨‍👩‍👧c", "éééé", "🇯🇵🇺🇸🇫🇷", "مرحبا بالعالم", ""];
    for (const text of samples) for (let max = 0; max <= 24; max++) for (const ellipsis of ["…", "...", ""]) expect(displayWidth(truncate(text, max, ellipsis)), `${text} @${max}`).toBeLessThanOrEqual(max);
  });
  it("never splits an emoji sequence", () => {
    const out = truncate("ab👨‍👩‍👧cd", 4, "");
    expect(out === "ab" || out === "ab👨‍👩‍👧").toBe(true);
    for (const cluster of graphemes(out)) expect(["a", "b", "👨‍👩‍👧"]).toContain(cluster);
  });
});

describe("pad", () => {
  it("pads by display width, not by length", () => {
    expect(displayWidth(pad("日本", 8))).toBe(8);
    expect(pad("ab", 5)).toBe("ab   ");
    expect(pad("ab", 5, "right")).toBe("   ab");
    expect(pad("ab", 5, "center")).toBe(" ab  ");
  });
  it("returns text unchanged when it is already wider", () => {
    expect(pad("abcdef", 3)).toBe("abcdef");
  });
});

describe("wrapText", () => {
  it("wraps on spaces and keeps paragraphs", () => {
    expect(wrapText("the quick brown fox", 9)).toEqual(["the quick", "brown fox"]);
    expect(wrapText("one\n\ntwo", 10)).toEqual(["one", "", "two"]);
  });
  it("breaks a word longer than a whole line", () => {
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
  it("never produces a line wider than the width, for any script", () => {
    const samples = ["the quick brown fox jumps over the lazy dog", "日本語のテキストが長く続きます", "a👨‍👩‍👧b👨‍👩‍👧c👨‍👩‍👧d", "https://example.com/a/very/long/path/with/no/spaces/at/all", "  leading and   multiple   spaces  "];
    for (const text of samples) for (let width = 1; width <= 30; width++) for (const line of wrapText(text, width)) expect(displayWidth(line), `${text} @${width}`).toBeLessThanOrEqual(Math.max(width, 2));
  });
  it("terminates for a width of zero or less", () => {
    expect(wrapText("abc def", 0).length).toBeGreaterThan(0);
    expect(wrapText("abc def", -5).length).toBeGreaterThan(0);
  });
  it("returns nothing for empty text but one blank line for a blank paragraph", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });
});

/**
 * Text handling for the terminal: sanitising untrusted text, measuring display width, truncating, padding and wrapping.
 *
 * Everything JPE draws may contain text from repositories, documentation or tool output, which are untrusted.
 * `sanitize` removes terminal escape sequences and control characters so that text can never move the cursor,
 * change colours, rewrite the title bar or spoof other output.
 */

const ESC = "\u001b";
const BEL = "\u0007";

// Order matters: strings terminated by ST or BEL first, then CSI, then two-character escapes.
const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?`, "g");
const STRING_SEQUENCE = new RegExp(`${ESC}[P^_X][\\s\\S]*?(?:${ESC}\\\\|$)`, "g");
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
// Any remaining ESC plus optional intermediate bytes plus a final byte: ESC c (full reset), ESC 7, ESC = and the like.
const SHORT_ESCAPE = new RegExp(`${ESC}[ -/]*[0-~]`, "g");
/** C0 controls except tab and newline, DEL, C1 controls, and every bidirectional override or isolate. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point of this pattern.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩‎‏؜]/g;

/** Removes escape sequences and control characters. Newlines are kept; tabs become two spaces. */
export function sanitize(text: string): string {
  return text
    .replace(OSC, "")
    .replace(STRING_SEQUENCE, "")
    .replace(CSI, "")
    .replace(SHORT_ESCAPE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(CONTROLS, "");
}

/** `sanitize`, then collapse every line break into a single space, for one-line contexts such as table cells. */
export function inline(text: string): string {
  return sanitize(text).replace(/\s*\n\s*/g, " ");
}

/** Removes ANSI colour and style sequences only. Used for measuring and for tests, not for untrusted input. */
export function stripAnsi(text: string): string {
  return text.replace(CSI, "");
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Splits text into user-perceived characters, so emoji sequences and accented letters are never cut in half. */
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

const ZERO_WIDTH: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x064b, 0x065f],
  [0x200b, 0x200d],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xe0100, 0xe01ef],
];

const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f1e6, 0x1f1ff],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
];

const inRanges = (cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

function codePointWidth(cp: number): 0 | 1 | 2 {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (inRanges(cp, ZERO_WIDTH)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}

/** Columns one user-perceived character takes: 0, 1 or 2. Emoji presentation sequences and ZWJ sequences take 2. */
export function graphemeWidth(cluster: string): 0 | 1 | 2 {
  if (cluster.includes("️")) return 2;
  for (const ch of cluster) {
    const width = codePointWidth(ch.codePointAt(0) ?? 0);
    if (width > 0) return width;
  }
  return 0;
}

/** How many terminal columns the text occupies. Escape sequences count as zero. */
export function displayWidth(text: string): number {
  let total = 0;
  for (const cluster of graphemes(stripAnsi(text))) total += graphemeWidth(cluster);
  return total;
}

/** Cuts text to at most `max` columns, ending with `ellipsis` when something was removed. */
export function truncate(text: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  if (displayWidth(text) <= max) return text;
  const room = max - displayWidth(ellipsis);
  if (room < 0) return graphemes(ellipsis).slice(0, max).join("");
  let used = 0;
  let out = "";
  for (const cluster of graphemes(text)) {
    const width = graphemeWidth(cluster);
    if (used + width > room) break;
    out += cluster;
    used += width;
  }
  return out + ellipsis;
}

export type Align = "left" | "right" | "center";

/** Pads with spaces to exactly `width` columns (text longer than `width` is returned unchanged). */
export function pad(text: string, width: number, align: Align = "left"): string {
  const gap = Math.max(0, width - displayWidth(text));
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + text + " ".repeat(gap - left);
  }
  return text + " ".repeat(gap);
}

/** Splits one over-long word into pieces no wider than `width`. */
function breakWord(word: string, width: number): string[] {
  const pieces: string[] = [];
  let current = "";
  let used = 0;
  for (const cluster of graphemes(word)) {
    const w = graphemeWidth(cluster);
    if (used + w > width && current !== "") {
      pieces.push(current);
      current = "";
      used = 0;
    }
    current += cluster;
    used += w;
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

/** Wraps text to `width` columns on spaces, breaking words that are longer than a whole line. Blank lines are kept. */
export function wrapText(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/ +/).filter(Boolean)) {
      for (const piece of displayWidth(word) > limit ? breakWord(word, limit) : [word]) {
        if (line === "") line = piece;
        else if (displayWidth(line) + 1 + displayWidth(piece) <= limit) line += ` ${piece}`;
        else {
          lines.push(line);
          line = piece;
        }
      }
    }
    if (line !== "") lines.push(line);
  }
  return lines;
}

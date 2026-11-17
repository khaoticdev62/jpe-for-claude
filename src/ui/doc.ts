/**
 * The neutral document every JPE screen is built from: lines of spans, each span carrying a meaning (a role), not a colour.
 *
 * Components in components.ts produce these. Two backends draw them: paint.ts turns them into ANSI text for the
 * command line, and the in-Claude-Code interface will turn the same spans into native elements. Because both start
 * from one document, the two can never disagree about what a screen says.
 */

import type { Role } from "./tokens.js";
import { displayWidth, truncate } from "./text.js";

export interface Span {
  text: string;
  role?: Role;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

export type Line = readonly Span[];

export interface SpanStyle {
  role?: Role;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

/** Builds a span without carrying `undefined` style fields (the project forbids explicit undefined for optional fields). */
export function span(text: string, style: SpanStyle = {}): Span {
  const out: Span = { text };
  if (style.role !== undefined) out.role = style.role;
  if (style.bold) out.bold = true;
  if (style.dim) out.dim = true;
  if (style.underline) out.underline = true;
  return out;
}

/** One line of unstyled text. */
export const plain = (text: string): Line => [span(text)];

export const lineText = (line: Line): string => line.map((s) => s.text).join("");

export const lineWidth = (line: Line): number => displayWidth(lineText(line));

/** Pads a line with spaces on the right to `width` columns. */
export function padLine(line: Line, width: number): Line {
  const gap = width - lineWidth(line);
  return gap > 0 ? [...line, span(" ".repeat(gap))] : line;
}

/** Cuts a line to `width` columns, keeping each span's style and ending with `ellipsis` when something was removed. */
export function fitLine(line: Line, width: number, ellipsis = "…"): Line {
  if (lineWidth(line) <= width) return line;
  const room = Math.max(0, width - displayWidth(ellipsis));
  const out: Span[] = [];
  let used = 0;
  for (const part of line) {
    const w = displayWidth(part.text);
    if (used + w <= room) {
      out.push(part);
      used += w;
      continue;
    }
    const cut = truncate(part.text, room - used, "");
    if (cut !== "") out.push({ ...part, text: cut });
    used += displayWidth(cut);
    break;
  }
  out.push(span(width >= displayWidth(ellipsis) ? ellipsis : ""));
  return out;
}

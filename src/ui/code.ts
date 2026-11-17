/**
 * Components for showing code and explanations together: a code block with line numbers and annotations, two panels
 * side by side (stacked when the terminal is narrow), collapsible sections, and callouts.
 *
 * Shared rules, as in components.ts: all text is sanitised, nothing is wider than the terminal, and nothing depends
 * on colour alone (annotations and marked lines carry a glyph and a word; screen-reader mode drops decoration and
 * reads each annotation as a sentence with its line number).
 */

import { type Line, fitLine, lineWidth, padLine, plain, span } from "./doc.js";
import { highlight, type Language } from "./highlight.js";
import type { RenderProfile } from "./profile.js";
import { displayWidth, inline, sanitize, truncate, wrapText } from "./text.js";
import type { StatusRole } from "./tokens.js";

export interface Annotation {
  /** The line number in the file (the same numbering as `startLine`). */
  line: number;
  level: Extract<StatusRole, "error" | "warning" | "info">;
  text: string;
}

export interface CodeBlockOptions {
  code: string;
  language: Language;
  /** The file's line number of the first line shown. Defaults to 1. */
  startLine?: number;
  annotations?: readonly Annotation[];
  width?: number;
  /** Show at most this many lines of code; the rest is summarised (including hidden annotations). */
  maxLines?: number;
  /** Line numbers to emphasise, for example the lines a change touched. */
  marked?: readonly number[];
}

const LEVEL_WORD: Readonly<Record<Annotation["level"], string>> = { error: "error", warning: "warning", info: "note" };
const MIN_CONTENT = 8;

/** Code with a line-number gutter, syntax colours, and annotations drawn beneath the lines they belong to. */
export function codeBlock(options: CodeBlockOptions, profile: RenderProfile): Line[] {
  const width = Math.min(options.width ?? profile.width, profile.width);
  const start = options.startLine ?? 1;
  const text = sanitize(options.code);
  const raw = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  const total = raw.length;
  const shownCount = options.maxLines === undefined ? total : Math.max(0, Math.min(total, options.maxLines));
  const marked = new Set(options.marked ?? []);
  const annotations = options.annotations ?? [];
  const byLine = new Map<number, Annotation[]>();
  for (const a of annotations) byLine.set(a.line, [...(byLine.get(a.line) ?? []), a]);

  const digits = String(start + total - 1).length;
  const { box, ellipsis, status } = profile.symbols;
  const plainMode = profile.screenReader;
  const gutterWidth = plainMode ? digits + 2 : digits + 3;
  const contentWidth = Math.max(MIN_CONTENT, width - gutterWidth);
  const lines = plainMode ? raw.map((l) => plain(l)) : highlight(raw.join("\n"), options.language);
  const markBar = profile.unicode ? "┃" : ">";

  const out: Line[] = [];
  for (let i = 0; i < shownCount; i++) {
    const lineNumber = start + i;
    const number = String(lineNumber).padStart(digits);
    const isMarked = marked.has(lineNumber);
    const gutter: Line = plainMode ? [span(`${number}: `, { role: "muted" })] : [span(number, { role: isMarked ? "accent" : "muted", bold: isMarked }), span(` ${isMarked ? markBar : box.vertical} `, { role: isMarked ? "accent" : "border" })];
    out.push(fitLine([...gutter, ...(lines[i] ?? plain(""))], width, ellipsis));

    for (const a of byLine.get(lineNumber) ?? []) {
      const label = `${LEVEL_WORD[a.level]}: ${inline(a.text)}`;
      if (plainMode) {
        for (const wrapped of wrapText(`Note on line ${lineNumber} (${label})`, Math.max(MIN_CONTENT, width))) out.push([span(wrapped, { role: a.level })]);
        continue;
      }
      // Wrapped to two columns narrower than the content so the glyph (first line) or the hanging indent (the rest) fits
      // without cutting any of the text.
      const indent = span(" ".repeat(digits + 3));
      const wrapped = wrapText(label, Math.max(1, contentWidth - 2));
      for (const [n, piece] of wrapped.entries()) out.push([indent, span(`${n === 0 ? status[a.level] : " "} ${piece}`, { role: a.level, bold: n === 0 })]);
    }
  }

  if (shownCount < total) {
    const hiddenAnnotations = annotations.filter((a) => a.line - start >= shownCount && a.line - start < total).length;
    const note = `${ellipsis} ${total - shownCount} more ${total - shownCount === 1 ? "line" : "lines"}${hiddenAnnotations === 0 ? "" : ` (${hiddenAnnotations} ${hiddenAnnotations === 1 ? "annotation" : "annotations"} hidden)`}`;
    out.push([span(" ".repeat(plainMode ? 0 : digits + 3)), span(truncate(note, contentWidth, ellipsis), { role: hiddenAnnotations === 0 ? "muted" : "warning" })]);
  }
  return out;
}

export interface Panel {
  title: string;
  /** Draws the panel's content at the width it is given. */
  render: (width: number) => Line[];
}

export interface SideBySideOptions {
  left: Panel;
  right: Panel;
  /** The fraction of the width for the left panel. Defaults to 0.6. */
  split?: number;
}

const MIN_SIDE_BY_SIDE = 80;
const MIN_COLUMN = 24;

/**
 * Two panels next to each other, each drawn at its own width. Below 80 columns, and in screen-reader mode, they are
 * stacked instead (left, then right) so nothing is squeezed past readability.
 */
export function sideBySide(options: SideBySideOptions, profile: RenderProfile): Line[] {
  const heading = (title: string): Line => [span(inline(title), { role: "heading", bold: true })];
  if (profile.screenReader || profile.width < MIN_SIDE_BY_SIDE) {
    // Stacked: a long title wraps, and whatever a panel draws is held to the width.
    const stacked = (panel: Panel): Line[] => [
      ...wrapText(inline(panel.title), profile.width).map((t): Line => [span(t, { role: "heading", bold: true })]),
      ...panel.render(profile.width).map((l) => fitLine(l, profile.width, profile.symbols.ellipsis)),
    ];
    return [...stacked(options.left), plain(""), ...stacked(options.right)];
  }
  const separator = ` ${profile.symbols.box.vertical} `;
  const room = profile.width - displayWidth(separator);
  const leftWidth = Math.max(MIN_COLUMN, Math.min(room - MIN_COLUMN, Math.round(room * (options.split ?? 0.6))));
  const rightWidth = room - leftWidth;
  const left = [heading(options.left.title), ...options.left.render(leftWidth)];
  const right = [heading(options.right.title), ...options.right.render(rightWidth)];
  const rows = Math.max(left.length, right.length);
  const out: Line[] = [];
  for (let i = 0; i < rows; i++) {
    const l = fitLine(left[i] ?? plain(""), leftWidth, profile.symbols.ellipsis);
    const r = fitLine(right[i] ?? plain(""), rightWidth, profile.symbols.ellipsis);
    out.push([...padLine(l, leftWidth), span(separator, { role: "border" }), ...r]);
  }
  return out;
}

export interface SectionOptions {
  title: string;
  body: readonly Line[];
  expanded: boolean;
}

/** A titled block that can be open or closed. Closed, it shows its title and how many lines are hidden. */
export function section(options: SectionOptions, profile: RenderProfile): Line[] {
  const title = inline(options.title);
  const count = options.body.length;
  // The title wraps rather than being cut: a long file name is information.
  const headLines = (text: string): Line[] => wrapText(text, profile.width).map((l): Line => [span(l, { role: "heading", bold: true })]);
  if (profile.screenReader) {
    const state = options.expanded ? "expanded" : `collapsed, ${count} ${count === 1 ? "line" : "lines"} hidden`;
    return [...headLines(`${title} (${state})`), ...(options.expanded ? options.body.map((l) => fitLine(l, profile.width, profile.symbols.ellipsis)) : [])];
  }
  const marker = profile.unicode ? (options.expanded ? "▾" : "▸") : options.expanded ? "v" : ">";
  const label = `${marker} ${title}${options.expanded ? "" : ` (${count} ${count === 1 ? "line" : "lines"})`}`;
  return [...headLines(label), ...(options.expanded ? options.body.map((l): Line => fitLine([span("  "), ...l], profile.width, profile.symbols.ellipsis)) : [])];
}

export interface CalloutOptions {
  level: StatusRole;
  title: string;
  body?: string;
}

const CALLOUT_WORD: Readonly<Record<StatusRole, string>> = { success: "OK", warning: "Warning", error: "Error", info: "Note", inactive: "Inactive", pending: "Pending" };

/** A highlighted note: a status glyph and word with a title, and an indented explanation beneath. */
export function callout(options: CalloutOptions, profile: RenderProfile): Line[] {
  const title = inline(options.title);
  const head = profile.screenReader ? `${CALLOUT_WORD[options.level]}: ${title}` : `${profile.symbols.status[options.level]} ${title}`;
  const wrapped = wrapText(head, profile.width).map((l): Line => [span(l, { role: options.level, bold: true })]);
  const body = options.body === undefined || options.body.trim() === "" ? [] : wrapText(sanitize(options.body), Math.max(MIN_CONTENT, profile.width - 2)).map((l): Line => [span("  "), span(l)]);
  return [...wrapped, ...body];
}

/** True when a rendered document fits the width: used by tests and by callers that must guarantee it. */
export const fits = (lines: readonly Line[], width: number): boolean => lines.every((l) => lineWidth(l) <= width);

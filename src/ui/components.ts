/**
 * Layout components. Each takes plain data and the render profile and returns lines of spans (see doc.ts).
 *
 * Shared behaviour:
 * - Every string is sanitised first, because content may come from repositories, docs or tool output.
 * - Nothing is ever wider than the profile's width; long content is truncated with an ellipsis or wrapped.
 * - Status is never colour-only: a glyph and a word always accompany the colour.
 * - In screen-reader mode borders and decoration are dropped and output is linear "Label: value" text.
 */

import { COMPLETION_STATUSES, type CompletionStatus } from "../core/status.js";
import { fitLine, type Line, lineWidth, padLine, plain, span } from "./doc.js";
import type { Action } from "./keymap.js";
import { chordLabel } from "./keymap.js";
import type { RenderProfile } from "./profile.js";
import { type Align, displayWidth, inline, pad, sanitize, truncate, wrapText } from "./text.js";
import type { Role, StatusRole } from "./tokens.js";

const BLANK: Line = plain("");

export const blank = (): Line => BLANK;

/** Wraps untrusted text into lines no wider than `width`. */
export function textLines(text: string, width: number, style: { role?: Role; bold?: boolean; dim?: boolean } = {}): Line[] {
  return wrapText(sanitize(text), width).map((line) => [span(line, style)]);
}

/** A section heading, wrapped (never cut off) to the width, followed by a blank line in comfortable density. */
export function heading(text: string, profile: RenderProfile): Line[] {
  const lines = wrapText(inline(text), profile.width).map((line): Line => [span(line, { role: "heading", bold: true })]);
  return profile.density === "comfortable" ? [...lines, BLANK] : lines;
}

const ROLE_WORDS: Readonly<Record<StatusRole, string>> = { success: "OK", warning: "Warning", error: "Error", info: "Note", inactive: "Inactive", pending: "Pending" };

/** Wraps a badge to the width, so a long status word is split across lines rather than cut off. */
function badgeLines(text: string, role: StatusRole, profile: RenderProfile): Line[] {
  return wrapText(text, profile.width).map((line): Line => [span(line, { role, bold: true })]);
}

/** A status marker: glyph plus label, in the status colour. Screen-reader mode spells the status out instead of using a glyph. */
export function statusBadge(role: StatusRole, label: string, profile: RenderProfile): Line[] {
  const text = inline(label);
  return badgeLines(profile.screenReader ? `${ROLE_WORDS[role]}: ${text}` : `${profile.symbols.status[role]} ${text}`, role, profile);
}

const STATUS_ROLE: Readonly<Record<CompletionStatus, StatusRole>> = {
  VERIFIED: "success",
  FUNCTIONAL_WITH_WARNINGS: "warning",
  PARTIALLY_VERIFIED: "warning",
  FAILED: "error",
  BLOCKED: "error",
  NOT_TESTED: "inactive",
};

/** The role JPE paints a completion status with. Exhaustive over the six status words. */
export const roleForStatus = (status: CompletionStatus): StatusRole => STATUS_ROLE[status];

/** A completion status as a badge. The exact status word is always shown (split across lines if the terminal is very narrow), never paraphrased. */
export function verificationBadge(status: CompletionStatus, profile: RenderProfile): Line[] {
  const role = STATUS_ROLE[status];
  return badgeLines(profile.screenReader ? `Status: ${status}` : `${profile.symbols.status[role]} ${status}`, role, profile);
}

/** Every status word JPE can report, for previews and tests. */
export const ALL_STATUSES: readonly CompletionStatus[] = COMPLETION_STATUSES;

export interface ProgressOptions {
  ratio: number;
  label?: string;
  width?: number;
}

const MAX_BAR = 30;
const MIN_BAR = 5;

/** A progress bar with the percentage always written out. Non-finite ratios count as 0; the ratio is clamped to 0..1. */
export function progressBar(options: ProgressOptions, profile: RenderProfile): Line {
  const ratio = Number.isFinite(options.ratio) ? Math.min(1, Math.max(0, options.ratio)) : 0;
  const percent = Math.round(ratio * 100);
  const label = options.label === undefined ? "" : inline(options.label);
  if (profile.screenReader) return plain(`${label === "" ? "Progress" : label}: ${percent} percent`);

  const available = Math.min(options.width ?? profile.width, profile.width);
  const suffix = ` ${String(percent).padStart(3)}%`;
  const prefix = label === "" ? "" : `${truncate(label, Math.max(4, Math.floor(available / 3)), profile.symbols.ellipsis)} `;
  const barWidth = Math.min(MAX_BAR, available - displayWidth(prefix) - suffix.length);
  if (barWidth < MIN_BAR) return fitLine(plain(`${prefix}${percent}%`), available, profile.symbols.ellipsis);

  const filled = Math.round(ratio * barWidth);
  return [
    ...(prefix === "" ? [] : [span(prefix, { role: "muted" })]),
    span(profile.symbols.barFull.repeat(filled), { role: "accent" }),
    span(profile.symbols.barEmpty.repeat(barWidth - filled), { role: "inactive" }),
    span(suffix, { role: "text" }),
  ];
}

export interface PanelOptions {
  title: string;
  body: readonly Line[];
  width?: number;
}

const MIN_PANEL = 12;

/** A bordered panel. Lines wider than the panel are truncated. In screen-reader mode: a heading and the body, no border. */
export function panel(options: PanelOptions, profile: RenderProfile): Line[] {
  const title = inline(options.title);
  if (profile.screenReader) {
    const head: Line = [span(title, { role: "heading", bold: true })];
    return [...(title === "" ? [] : [head]), ...options.body.map((line) => fitLine(line, profile.width, profile.symbols.ellipsis)), BLANK];
  }

  const { box, ellipsis } = profile.symbols;
  const width = Math.max(MIN_PANEL, Math.min(options.width ?? profile.width, profile.width));
  const inner = width - 4;
  const border = (text: string): Line => [span(text, { role: "border" })];

  const shownTitle = truncate(title, width - 6, ellipsis);
  const top: Line =
    shownTitle === ""
      ? border(`${box.topLeft}${box.horizontal.repeat(width - 2)}${box.topRight}`)
      : [
          span(`${box.topLeft}${box.horizontal} `, { role: "border" }),
          span(shownTitle, { role: "heading", bold: true }),
          span(` ${box.horizontal.repeat(Math.max(0, width - 5 - displayWidth(shownTitle)))}${box.topRight}`, { role: "border" }),
        ];

  const rows = options.body.map((line): Line => [span(`${box.vertical} `, { role: "border" }), ...padLine(fitLine(line, inner, ellipsis), inner), span(` ${box.vertical}`, { role: "border" })]);
  return [top, ...rows, border(`${box.bottomLeft}${box.horizontal.repeat(width - 2)}${box.bottomRight}`)];
}

export interface TableColumn {
  header: string;
  align?: Align;
  /** The narrowest this column may be squeezed to before the table switches to stacked rows. */
  min?: number;
}

export interface TableOptions {
  columns: readonly TableColumn[];
  rows: readonly (readonly string[])[];
  width?: number;
}

const DEFAULT_MIN_COLUMN = 6;

const MIN_INLINE_VALUE = 10;

/** One block of "Header: value" lines per row. When the value would have under 10 columns beside its header, it moves to indented lines beneath. */
function stackedRows(options: TableOptions, profile: RenderProfile, available: number): Line[] {
  const out: Line[] = [];
  options.rows.forEach((row, index) => {
    if (index > 0 && profile.density === "comfortable") out.push(BLANK);
    options.columns.forEach((column, i) => {
      const key = `${inline(column.header)}: `;
      const value = inline(row[i] ?? "");
      const beside = available - displayWidth(key) >= MIN_INLINE_VALUE;
      if (beside) {
        const wrapped = wrapText(value, available - displayWidth(key));
        (wrapped.length === 0 ? [""] : wrapped).forEach((text, n) => {
          out.push(n === 0 ? [span(key, { role: "muted" }), span(text)] : [span(" ".repeat(displayWidth(key))), span(text)]);
        });
        return;
      }
      out.push(fitLine([span(key.trimEnd(), { role: "muted" })], available, profile.symbols.ellipsis));
      const wrapped = wrapText(value, Math.max(1, available - 2));
      for (const text of wrapped.length === 0 ? [""] : wrapped) out.push([span("  "), span(text)]);
    });
  });
  return out;
}

/**
 * A table that adapts: columns are squeezed (and cells truncated with an ellipsis) to fit the width; when that is
 * not enough, or in screen-reader mode, each row becomes a block of "Header: value" lines instead.
 */
export function table(options: TableOptions, profile: RenderProfile): Line[] {
  const available = Math.min(options.width ?? profile.width, profile.width);
  const columns = options.columns;
  if (columns.length === 0) return [];
  if (profile.screenReader) return stackedRows(options, profile, available);

  const cell = (row: readonly string[], i: number): string => inline(row[i] ?? "");
  const widths = columns.map((column, i) => Math.max(displayWidth(inline(column.header)), ...options.rows.map((row) => displayWidth(cell(row, i)))));
  const mins = columns.map((column, i) => Math.min(widths[i] ?? 0, column.min ?? DEFAULT_MIN_COLUMN));
  const separator = ` ${profile.symbols.box.separator} `;
  const gaps = displayWidth(separator) * (columns.length - 1);

  let total = widths.reduce((a, b) => a + b, 0) + gaps;
  while (total > available) {
    let widest = -1;
    widths.forEach((w, i) => {
      if (w > (mins[i] ?? 0) && (widest === -1 || w > (widths[widest] ?? 0))) widest = i;
    });
    if (widest === -1) return stackedRows(options, profile, available);
    widths[widest] = (widths[widest] ?? 1) - 1;
    total -= 1;
  }

  const render = (texts: readonly string[], style: { bold?: boolean; role?: Role }): Line => {
    const parts = texts.map((text, i) => pad(truncate(text, widths[i] ?? 0, profile.symbols.ellipsis), widths[i] ?? 0, columns[i]?.align ?? "left"));
    const spans = parts.flatMap((text, i) => (i === 0 ? [span(text, style)] : [span(separator, { role: "border" }), span(text, style)]));
    return spans;
  };

  const head = render(columns.map((c) => inline(c.header)), { bold: true, role: "heading" });
  const rule: Line = [span(profile.symbols.box.horizontal.repeat(Math.min(available, lineWidth(head))), { role: "border" })];
  return [head, rule, ...options.rows.map((row) => render(columns.map((_, i) => cell(row, i)), {}))];
}

/** Aligned "key  value" lines. Below 40 columns, or in screen-reader mode, each pair is written "Key: value". */
export function keyValues(pairs: readonly (readonly [string, string])[], profile: RenderProfile): Line[] {
  const keys = pairs.map(([key]) => inline(key));
  const keyWidth = Math.max(0, ...keys.map(displayWidth));
  const linear = profile.screenReader || profile.width < 40;
  return pairs.map(([, value], i): Line => {
    const key = keys[i] ?? "";
    const text = inline(value);
    if (linear) return fitLine([span(`${key}: `, { role: "muted" }), span(text)], profile.width, profile.symbols.ellipsis);
    const room = Math.max(1, profile.width - keyWidth - 2);
    return [span(pad(key, keyWidth), { role: "muted" }), span("  "), span(truncate(text, room, profile.symbols.ellipsis))];
  });
}

/** A bulleted list; each item is wrapped and continuation lines are indented under the text. */
export function bulletList(items: readonly string[], profile: RenderProfile): Line[] {
  const bullet = `${profile.symbols.bullet} `;
  const indent = " ".repeat(displayWidth(bullet));
  return items.flatMap((item) =>
    wrapText(inline(item), Math.max(8, profile.width - displayWidth(bullet))).map((text, i): Line => [span(i === 0 ? bullet : indent, { role: "muted" }), span(text)]),
  );
}

const ACTION_WORDS: Readonly<Record<Action, string>> = {
  up: "move up",
  down: "move down",
  left: "move left",
  right: "move right",
  select: "open",
  back: "back",
  quit: "quit",
  search: "search",
  palette: "commands",
  help: "help",
  "next-pane": "next pane",
  "prev-pane": "previous pane",
  top: "top",
  bottom: "bottom",
  "page-up": "page up",
  "page-down": "page down",
  "toggle-expand": "expand or collapse",
  favorite: "favorite",
  refresh: "refresh",
};

/** A footer of key hints (`Enter: open  /: search`), wrapped to the width, built from the live keymap. */
export function keyHints(actions: readonly Action[], profile: RenderProfile): Line[] {
  const hints = actions.map((action) => {
    const chords = profile.keymap.byAction[action].slice(0, 2).map(chordLabel);
    return `${chords.join("/")}: ${ACTION_WORDS[action]}`;
  });
  const lines: Line[] = [];
  let current = "";
  for (const hint of hints) {
    if (current !== "" && displayWidth(current) + 2 + displayWidth(hint) > profile.width) {
      lines.push([span(current, { role: "muted" })]);
      current = hint;
    } else current = current === "" ? hint : `${current}  ${hint}`;
  }
  if (current !== "") lines.push([span(current, { role: "muted" })]);
  return lines;
}

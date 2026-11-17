/** Glyph sets: a Unicode set for capable terminals and an ASCII set that always works. Same meanings, different shapes. */

import type { StatusRole } from "./tokens.js";

export interface BoxChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
  /** Between table columns. */
  separator: string;
}

export interface SymbolSet {
  /** One glyph per status. Each has a distinct shape so a status is readable without colour. */
  status: Readonly<Record<StatusRole, string>>;
  box: BoxChars;
  barFull: string;
  barEmpty: string;
  ellipsis: string;
  bullet: string;
  arrow: string;
}

export const UNICODE_SYMBOLS: SymbolSet = {
  status: { success: "✔", warning: "▲", error: "✘", info: "◆", inactive: "○", pending: "…" },
  box: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│", separator: "│" },
  barFull: "█",
  barEmpty: "░",
  ellipsis: "…",
  bullet: "•",
  arrow: "→",
};

export const ASCII_SYMBOLS: SymbolSet = {
  status: { success: "+", warning: "!", error: "x", info: "i", inactive: "-", pending: "~" },
  box: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|", separator: "|" },
  barFull: "#",
  barEmpty: "-",
  ellipsis: "...",
  bullet: "*",
  arrow: "->",
};

export const symbolsFor = (unicode: boolean): SymbolSet => (unicode ? UNICODE_SYMBOLS : ASCII_SYMBOLS);

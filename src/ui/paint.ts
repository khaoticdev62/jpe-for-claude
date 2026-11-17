/**
 * The ANSI backend: turns a document (lines of spans) into text for the terminal, honouring the render profile.
 *
 * Rules that keep output safe and readable:
 * - Text is sanitised again here, so no span can inject an escape sequence whatever built it.
 * - With colour off or output piped there are no escape sequences at all (when `styles` is false).
 * - In `terminal` surface mode, ordinary text keeps the terminal's own colour and secondary text is dimmed, so the
 *   output stays readable on light and dark backgrounds alike. Only accents and status colours are painted.
 */

import { toAnsi256, parseHex } from "./color.js";
import type { Line, Span } from "./doc.js";
import type { RenderProfile } from "./profile.js";
import { sanitize } from "./text.js";
import type { Role } from "./tokens.js";

const CSI = "\u001b[";
const RESET = `${CSI}0m`;

interface TerminalTreatment {
  bold?: boolean;
  dim?: boolean;
  /** Paint with another role's colour (headings use the accent). Omit to keep the terminal's own colour. */
  colorAs?: Role;
}

/** How `terminal` surface mode treats roles whose theme colour is meant for JPE's own dark or light surface. */
const TERMINAL_STYLE_ROLES: Readonly<Partial<Record<Role, TerminalTreatment>>> = {
  text: {},
  muted: { dim: true },
  heading: { bold: true, colorAs: "accent" },
  border: { dim: true },
  inactive: { dim: true },
};

function foregroundCode(profile: RenderProfile, role: Role): string | undefined {
  if (profile.color === "none") return undefined;
  let colorRole = role;
  if (profile.surface === "terminal" && role in TERMINAL_STYLE_ROLES) {
    const treatment = TERMINAL_STYLE_ROLES[role];
    if (treatment?.colorAs === undefined) return undefined;
    colorRole = treatment.colorAs;
  }
  const hex = profile.theme.colors[colorRole];
  if (profile.color === "truecolor") {
    const { r, g, b } = parseHex(hex);
    return `38;2;${r};${g};${b}`;
  }
  if (profile.color === "256") return `38;5;${toAnsi256(hex)}`;
  const index = profile.theme.ansi16[colorRole];
  return index < 8 ? `${30 + index}` : `${90 + index - 8}`;
}

/** The SGR parameter list for one span, or "" when it has no styling. */
export function sgrFor(profile: RenderProfile, part: Span): string {
  if (!profile.styles) return "";
  const role = part.role ?? "text";
  const standIn = profile.surface === "terminal" ? TERMINAL_STYLE_ROLES[role] : undefined;
  const codes: string[] = [];
  if (part.bold || standIn?.bold) codes.push("1");
  if (part.dim || standIn?.dim) codes.push("2");
  if (part.underline) codes.push("4");
  const color = foregroundCode(profile, role);
  if (color) codes.push(color);
  return codes.join(";");
}

/** One line as terminal text. */
export function paintLine(line: Line, profile: RenderProfile): string {
  let out = "";
  for (const part of line) {
    const text = sanitize(part.text).replace(/\n/g, " ");
    if (text === "") continue;
    const sgr = sgrFor(profile, part);
    out += sgr === "" ? text : `${CSI}${sgr}m${text}${RESET}`;
  }
  return out;
}

/** A whole document as terminal text, one string per line joined with newlines. */
export function paint(lines: readonly Line[], profile: RenderProfile): string {
  return lines.map((line) => paintLine(line, profile)).join("\n");
}

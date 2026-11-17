/**
 * Terminal capability detection: what the terminal can show, decided from the environment and the stream,
 * with a plain-English reason for every decision so `jpe ui` and Doctor can explain themselves.
 *
 * Pure function: no process globals are read here, everything comes in through `TerminalInput`.
 */

export type ColorDepth = "none" | "16" | "256" | "truecolor";

export interface TerminalInput {
  env: Readonly<Record<string, string | undefined>>;
  platform: string;
  /** Whether standard output is an interactive terminal (not a pipe or a file). */
  isTTY: boolean;
  columns?: number | undefined;
  rows?: number | undefined;
}

export interface Capabilities {
  color: ColorDepth;
  /** Bold, dim and underline are allowed (a real terminal that understands escape sequences). */
  styles: boolean;
  unicode: boolean;
  columns: number;
  rows: number;
  interactive: boolean;
  remote: boolean;
  ci: boolean;
  reducedMotion: boolean;
  screenReader: boolean;
  /** One sentence per decision above, in the order they were made. */
  reasons: string[];
}

export const MIN_COLUMNS = 20;
export const MAX_COLUMNS = 500;
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

const isSet = (value: string | undefined): value is string => value !== undefined && value !== "";
const isTruthy = (value: string | undefined): boolean => isSet(value) && value !== "0" && value.toLowerCase() !== "false";

const clampInt = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.trunc(value)));

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!isSet(value) || !/^\d{1,5}$/.test(value)) return undefined;
  const n = Number.parseInt(value, 10);
  return n > 0 ? n : undefined;
}

const TRUECOLOR_PROGRAMS: ReadonlySet<string> = new Set(["iTerm.app", "vscode", "WezTerm", "Hyper", "ghostty"]);
const BASIC_TERMS = /(xterm|screen|tmux|rxvt|linux|vt100|vt220|ansi|cygwin|color)/i;

function detectColor(input: TerminalInput, reasons: string[]): ColorDepth {
  const { env } = input;
  const term = env["TERM"] ?? "";
  if (isSet(env["NO_COLOR"])) {
    reasons.push("Colour is off because NO_COLOR is set.");
    return "none";
  }
  const force = env["FORCE_COLOR"];
  if (isSet(force)) {
    const level: Record<string, ColorDepth> = { "0": "none", false: "none", "1": "16", true: "16", "2": "256", "3": "truecolor" };
    const forced = level[force.toLowerCase()];
    if (forced) {
      reasons.push(`Colour depth is ${forced} because FORCE_COLOR=${force}.`);
      return forced;
    }
  }
  if (!input.isTTY) {
    reasons.push("Colour is off because output is not an interactive terminal (it is piped or redirected).");
    return "none";
  }
  if (term === "dumb") {
    reasons.push("Colour is off because TERM=dumb.");
    return "none";
  }
  const colorterm = (env["COLORTERM"] ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") {
    reasons.push("Truecolor because COLORTERM advertises it.");
    return "truecolor";
  }
  if (isSet(env["WT_SESSION"])) {
    reasons.push("Truecolor because this is Windows Terminal.");
    return "truecolor";
  }
  if (isSet(env["TERM_PROGRAM"]) && TRUECOLOR_PROGRAMS.has(env["TERM_PROGRAM"])) {
    reasons.push(`Truecolor because TERM_PROGRAM=${env["TERM_PROGRAM"]}.`);
    return "truecolor";
  }
  if (/256color/i.test(term)) {
    reasons.push("256 colours because TERM names 256color.");
    return "256";
  }
  if (input.platform === "win32") {
    reasons.push("Truecolor assumed for a Windows console (Windows 10 and later). Override with ui.color if colours look wrong.");
    return "truecolor";
  }
  if (BASIC_TERMS.test(term)) {
    reasons.push(`16 colours because TERM=${term} does not advertise more.`);
    return "16";
  }
  reasons.push("16 colours as a safe default: the terminal did not say what it supports.");
  return "16";
}

function localeIsUtf8(env: TerminalInput["env"]): boolean | undefined {
  const locale = [env["LC_ALL"], env["LC_CTYPE"], env["LANG"]].find(isSet);
  if (locale === undefined) return undefined;
  return /utf-?8/i.test(locale);
}

function detectUnicode(input: TerminalInput, reasons: string[]): boolean {
  const { env } = input;
  const term = env["TERM"] ?? "";
  if (isTruthy(env["JPE_ASCII"])) {
    reasons.push("ASCII symbols because JPE_ASCII is set.");
    return false;
  }
  if (term === "dumb" || term === "linux") {
    reasons.push(`ASCII symbols because TERM=${term} (the Linux console and dumb terminals lack most box and symbol glyphs).`);
    return false;
  }
  const utf8 = localeIsUtf8(env);
  if (utf8 === false) {
    reasons.push("ASCII symbols because the locale is not UTF-8.");
    return false;
  }
  if (utf8 === true) {
    reasons.push("Unicode symbols because the locale is UTF-8.");
    return true;
  }
  if (input.platform === "win32") {
    const modern = isSet(env["WT_SESSION"]) || isSet(env["TERM_PROGRAM"]) || env["ConEmuANSI"] === "ON";
    reasons.push(modern ? "Unicode symbols because this is a modern Windows terminal." : "ASCII symbols because this looks like the legacy Windows console. Override with ui.unicode if yours supports Unicode.");
    return modern;
  }
  reasons.push("Unicode symbols assumed: no locale was set and TERM is not a known ASCII-only terminal.");
  return true;
}

/** Decides what the terminal can show. Never throws; every input has a safe default. */
export function detectCapabilities(input: TerminalInput): Capabilities {
  const { env } = input;
  const reasons: string[] = [];

  const color = detectColor(input, reasons);
  const styles = (input.isTTY && (env["TERM"] ?? "") !== "dumb") || (isSet(env["FORCE_COLOR"]) && env["FORCE_COLOR"] !== "0");
  const unicode = detectUnicode(input, reasons);

  const columns = clampInt(input.columns ?? parsePositiveInt(env["COLUMNS"]) ?? DEFAULT_COLUMNS, MIN_COLUMNS, MAX_COLUMNS);
  const rows = clampInt(input.rows ?? parsePositiveInt(env["LINES"]) ?? DEFAULT_ROWS, 5, 200);
  reasons.push(input.columns !== undefined ? `Width is ${columns} columns, read from the terminal.` : `Width is ${columns} columns (${isSet(env["COLUMNS"]) ? "from COLUMNS" : "the default; the terminal size is unknown"}).`);

  const remote = isSet(env["SSH_CONNECTION"]) || isSet(env["SSH_TTY"]) || isSet(env["SSH_CLIENT"]);
  const ci = isTruthy(env["CI"]);
  const interactive = input.isTTY && !ci && (env["TERM"] ?? "") !== "dumb";
  if (remote) reasons.push("Remote (SSH) session: animation is reduced and the layout stays compact-friendly.");
  if (ci) reasons.push("CI environment: output is plain and non-interactive.");

  const reducedMotion = isTruthy(env["JPE_REDUCED_MOTION"]) || remote || ci || !input.isTTY;
  const screenReader = isTruthy(env["JPE_SCREEN_READER"]);
  reasons.push(screenReader ? "Screen-reader layout is on because JPE_SCREEN_READER is set." : "Screen-reader layout is off. It cannot be detected automatically; turn it on with ui.screenReader or JPE_SCREEN_READER=1.");

  return { color, styles, unicode, columns, rows, interactive, remote, ci, reducedMotion, screenReader, reasons };
}

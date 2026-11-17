// src/mod/center.tsx
import { atom, read, update } from "claude-code";

// src/center/commands.ts
var command = (id, title, summary, group, changesThings, keywords, argHint) => ({
  id,
  slash: `jpe:${id}`,
  title,
  summary,
  group,
  changesThings,
  keywords,
  ...argHint === void 0 ? {} : { argHint }
});
var CENTER_COMMANDS = [
  command("explain", "Explain", "Explain code in everyday English, with the real technical terms in parentheses", "Understand", false, ["what does", "walk through", "describe", "understand", "plain english"], "<file or topic>"),
  command("research", "Research", "Look up the official documentation for the exact installed version, with sources", "Understand", false, ["docs", "documentation", "api", "version", "library", "deprecated"], "<library>"),
  command("learn", "Learn", "Learn a programming concept using this project's own code", "Understand", false, ["teach", "concept", "tutorial", "lesson"], "<concept>"),
  command("impact", "Impact", "See what else depends on a file before you change it", "Understand", false, ["dependents", "refactor", "rename", "blast radius", "who uses"], "<file>"),
  command("verify", "Verify", "Run the project's real tests, type checks and build, and report evidence", "Check", false, ["test", "build", "lint", "typecheck", "does it work", "check"]),
  command("status", "Status", "Show the latest verification status and what backs it", "Check", false, ["result", "last run", "evidence", "passed", "failed"]),
  command("audit", "Audit", "Review the project for risky patterns and exposed credentials", "Check", false, ["security", "secrets", "vulnerabilities", "safe", "review"]),
  command("fix", "Fix", "Investigate a failure and repair it in small, checked steps with a backup", "Change", true, ["repair", "bug", "broken", "error", "failing", "debug"]),
  command("setup", "Setup", "Check JPE's health and set up language servers", "Manage", true, ["doctor", "install", "health", "language server", "diagnose"]),
  command("config", "Config", "View or change JPE's settings", "Manage", true, ["settings", "preferences", "theme", "options", "configure"])
];
var findCommand = (id) => CENTER_COMMANDS.find((c) => c.id === id);
var isCommandId = (id) => findCommand(id) !== void 0;

// src/ui/text.ts
var ESC = "\x1B";
var BEL = "\x07";
var OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?`, "g");
var STRING_SEQUENCE = new RegExp(`${ESC}[P^_X][\\s\\S]*?(?:${ESC}\\\\|$)`, "g");
var CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
var SHORT_ESCAPE = new RegExp(`${ESC}[ -/]*[0-~]`, "g");
var CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩‎‏؜]/g;
function sanitize(text) {
  return text.replace(OSC, "").replace(STRING_SEQUENCE, "").replace(CSI, "").replace(SHORT_ESCAPE, "").replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(CONTROLS, "");
}
function inline(text) {
  return sanitize(text).replace(/\s*\n\s*/g, " ");
}
function stripAnsi(text) {
  return text.replace(CSI, "");
}
var segmenter = new Intl.Segmenter(void 0, { granularity: "grapheme" });
function graphemes(text) {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}
var ZERO_WIDTH = [
  [768, 879],
  [1155, 1161],
  [1425, 1469],
  [1611, 1631],
  [8203, 8205],
  [8400, 8447],
  [65024, 65039],
  [65056, 65071],
  [917760, 917999]
];
var WIDE = [
  [4352, 4447],
  [11904, 12350],
  [12353, 13311],
  [13312, 19903],
  [19968, 40959],
  [40960, 42191],
  [44032, 55203],
  [63744, 64255],
  [65072, 65135],
  [65280, 65376],
  [65504, 65510],
  [127462, 127487],
  [127744, 128591],
  [128640, 128767],
  [129280, 129535],
  [129648, 129791],
  [131072, 262141]
];
var inRanges = (cp, ranges) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
function codePointWidth(cp) {
  if (cp < 32 || cp >= 127 && cp < 160) return 0;
  if (inRanges(cp, ZERO_WIDTH)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}
function graphemeWidth(cluster) {
  if (cluster.includes("\uFE0F")) return 2;
  for (const ch of cluster) {
    const width = codePointWidth(ch.codePointAt(0) ?? 0);
    if (width > 0) return width;
  }
  return 0;
}
function displayWidth(text) {
  let total = 0;
  for (const cluster of graphemes(stripAnsi(text))) total += graphemeWidth(cluster);
  return total;
}
function truncate(text, max, ellipsis = "\u2026") {
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
function pad(text, width, align = "left") {
  const gap = Math.max(0, width - displayWidth(text));
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + text + " ".repeat(gap - left);
  }
  return text + " ".repeat(gap);
}
function breakWord(word, width) {
  const pieces = [];
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
function wrapText(text, width) {
  const limit = Math.max(1, width);
  const lines = [];
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

// src/ui/doc.ts
function span(text, style = {}) {
  const out = { text };
  if (style.role !== void 0) out.role = style.role;
  if (style.bold) out.bold = true;
  if (style.dim) out.dim = true;
  if (style.underline) out.underline = true;
  return out;
}
var plain = (text) => [span(text)];
var lineText = (line) => line.map((s) => s.text).join("");
var lineWidth = (line) => displayWidth(lineText(line));
function fitLine(line, width, ellipsis = "\u2026") {
  if (lineWidth(line) <= width) return line;
  const room = Math.max(0, width - displayWidth(ellipsis));
  const out = [];
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

// src/ui/keymap.ts
var ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "select",
  "back",
  "quit",
  "search",
  "palette",
  "help",
  "next-pane",
  "prev-pane",
  "top",
  "bottom",
  "page-up",
  "page-down",
  "toggle-expand",
  "favorite",
  "refresh"
];
var CHORD_PATTERN = /^(?:(?:ctrl|alt|shift)\+)*(?:[a-zA-Z0-9/?:.,;'=\-[\]\\`]|enter|esc|tab|space|up|down|left|right|home|end|pageup|pagedown|backspace|delete|f(?:[1-9]|1[0-2]))$/;
var MODIFIER_ORDER = ["ctrl", "alt", "shift"];
var RESERVED = { "ctrl+c": "quit", esc: "back" };
function normalizeChord(raw) {
  const text = raw.trim();
  if (!CHORD_PATTERN.test(text)) return void 0;
  const parts = text.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = new Set(parts.slice(0, -1));
  let name = key;
  if (key.length === 1 && key !== key.toLowerCase()) {
    modifiers.add("shift");
    name = key.toLowerCase();
  } else if (key.length > 1) {
    name = key.toLowerCase();
  }
  const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m));
  return [...ordered, name].join("+");
}
var COMMON = {
  up: [],
  down: [],
  left: [],
  right: [],
  select: ["enter"],
  back: ["esc", "backspace"],
  quit: ["q", "ctrl+c"],
  search: ["/"],
  palette: ["ctrl+p"],
  help: ["?"],
  "next-pane": ["tab"],
  "prev-pane": ["shift+tab"],
  top: [],
  bottom: [],
  "page-up": [],
  "page-down": [],
  "toggle-expand": ["space"],
  favorite: ["f"],
  refresh: ["r"]
};
var ARROWS = { up: ["up"], down: ["down"], left: ["left"], right: ["right"], top: ["home"], bottom: ["end"], "page-up": ["pageup"], "page-down": ["pagedown"] };
var VIM = { up: ["k"], down: ["j"], left: ["h"], right: ["l"], top: ["g"], bottom: ["shift+g"], "page-up": ["ctrl+u"], "page-down": ["ctrl+d"] };
function defaultBindings(style) {
  const sources = style === "standard" ? [ARROWS] : style === "vim" ? [VIM] : [ARROWS, VIM];
  const merged = {};
  for (const action of ACTIONS) merged[action] = [...COMMON[action], ...sources.flatMap((s) => s[action] ?? [])];
  return merged;
}
function buildKeymap(style, overrides = {}) {
  const defaults = defaultBindings(style);
  const problems = [];
  const desired = {};
  const overridden = /* @__PURE__ */ new Set();
  for (const action of ACTIONS) {
    const supplied = overrides[action];
    if (supplied === void 0) {
      desired[action] = [...defaults[action]];
      continue;
    }
    overridden.add(action);
    const accepted = [];
    for (const raw of supplied) {
      const chord = normalizeChord(raw);
      if (chord === void 0) problems.push({ action, chord: raw, kind: "invalid-chord", message: `"${raw}" is not a valid key.` });
      else if (RESERVED[chord] !== void 0 && RESERVED[chord] !== action) problems.push({ action, chord, kind: "reserved", message: `${chord} is reserved for "${RESERVED[chord]}" so you can always leave.` });
      else if (!accepted.includes(chord)) accepted.push(chord);
    }
    desired[action] = accepted;
  }
  for (const [chord, action] of Object.entries(RESERVED)) {
    if (!desired[action].includes(chord)) desired[action].push(chord);
  }
  const MAX_PASSES = 50;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    for (const action of overridden) {
      if (desired[action].length > 0) continue;
      overridden.delete(action);
      desired[action] = [...defaults[action]];
      problems.push({ action, chord: "", kind: "empty", message: `No usable key was left for "${action}", so its defaults were kept.` });
    }
    const claims = /* @__PURE__ */ new Map();
    for (const action of ACTIONS) for (const chord of desired[action]) claims.set(chord, [...claims.get(chord) ?? [], action]);
    const collisions = [...claims].filter(([, actions]) => actions.length > 1);
    if (collisions.length === 0) break;
    for (const [chord, actions] of collisions) {
      const owner = RESERVED[chord];
      const defaultHolders = actions.filter((a) => !overridden.has(a));
      const losers = owner !== void 0 && actions.includes(owner) ? actions.filter((a) => a !== owner) : defaultHolders.length > 0 ? actions.filter((a) => overridden.has(a)) : actions;
      for (const action of losers) {
        if (!desired[action].includes(chord)) continue;
        desired[action] = desired[action].filter((c) => c !== chord);
        problems.push({ action, chord, kind: "conflict", message: `${chord} is already used by ${actions.filter((a) => a !== action).join(", ")}.` });
      }
    }
  }
  const bindings = /* @__PURE__ */ new Map();
  for (const action of ACTIONS) for (const chord of desired[action]) if (!bindings.has(chord)) bindings.set(chord, action);
  return { bindings, byAction: desired, problems };
}

// src/ui/components.ts
var BLANK = plain("");
var blank = () => BLANK;
function textLines(text, width, style = {}) {
  return wrapText(sanitize(text), width).map((line) => [span(line, style)]);
}
function heading(text, profile) {
  const lines = wrapText(inline(text), profile.width).map((line) => [span(line, { role: "heading", bold: true })]);
  return profile.density === "comfortable" ? [...lines, BLANK] : lines;
}
function badgeLines(text, role, profile) {
  return wrapText(text, profile.width).map((line) => [span(line, { role, bold: true })]);
}
var STATUS_ROLE = {
  VERIFIED: "success",
  FUNCTIONAL_WITH_WARNINGS: "warning",
  PARTIALLY_VERIFIED: "warning",
  FAILED: "error",
  BLOCKED: "error",
  NOT_TESTED: "inactive"
};
function verificationBadge(status, profile) {
  const role = STATUS_ROLE[status];
  return badgeLines(profile.screenReader ? `Status: ${status}` : `${profile.symbols.status[role]} ${status}`, role, profile);
}
var DEFAULT_MIN_COLUMN = 6;
var MIN_INLINE_VALUE = 10;
function stackedRows(options, profile, available) {
  const out = [];
  options.rows.forEach((row, index) => {
    if (index > 0 && profile.density === "comfortable") out.push(BLANK);
    options.columns.forEach((column, i) => {
      const key = `${inline(column.header)}: `;
      const value = inline(row[i] ?? "");
      const beside = available - displayWidth(key) >= MIN_INLINE_VALUE;
      if (beside) {
        const wrapped2 = wrapText(value, available - displayWidth(key));
        (wrapped2.length === 0 ? [""] : wrapped2).forEach((text, n) => {
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
function table(options, profile) {
  const available = Math.min(options.width ?? profile.width, profile.width);
  const columns = options.columns;
  if (columns.length === 0) return [];
  if (profile.screenReader) return stackedRows(options, profile, available);
  const cell = (row, i) => inline(row[i] ?? "");
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
  const render = (texts, style) => {
    const parts = texts.map((text, i) => pad(truncate(text, widths[i] ?? 0, profile.symbols.ellipsis), widths[i] ?? 0, columns[i]?.align ?? "left"));
    const spans = parts.flatMap((text, i) => i === 0 ? [span(text, style)] : [span(separator, { role: "border" }), span(text, style)]);
    return spans;
  };
  const head = render(columns.map((c) => inline(c.header)), { bold: true, role: "heading" });
  const rule = [span(profile.symbols.box.horizontal.repeat(Math.min(available, lineWidth(head))), { role: "border" })];
  return [head, rule, ...options.rows.map((row) => render(columns.map((_, i) => cell(row, i)), {}))];
}
function bulletList(items, profile) {
  const bullet = `${profile.symbols.bullet} `;
  const indent = " ".repeat(displayWidth(bullet));
  return items.flatMap(
    (item) => wrapText(inline(item), Math.max(8, profile.width - displayWidth(bullet))).map((text, i) => [span(i === 0 ? bullet : indent, { role: "muted" }), span(text)])
  );
}

// src/center/memory.ts
var MEMORY_VERSION = 1;
var MAX_FAVORITES = 20;
var MAX_HISTORY = 50;
var EMPTY_MEMORY = { version: MEMORY_VERSION, favorites: [], history: [] };
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isIso = (value) => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
function parseMemory(raw) {
  if (!isRecord(raw)) return { ...EMPTY_MEMORY, favorites: [], history: [] };
  const favorites = [];
  if (Array.isArray(raw["favorites"])) {
    for (const id of raw["favorites"]) if (typeof id === "string" && isCommandId(id) && !favorites.includes(id)) favorites.push(id);
  }
  const history = [];
  if (Array.isArray(raw["history"])) {
    for (const entry of raw["history"]) {
      if (isRecord(entry) && typeof entry["id"] === "string" && isCommandId(entry["id"]) && isIso(entry["at"])) history.push({ id: entry["id"], at: entry["at"] });
    }
  }
  return { version: MEMORY_VERSION, favorites: favorites.slice(0, MAX_FAVORITES), history: history.slice(0, MAX_HISTORY) };
}
function recordUse(memory, id, at) {
  if (!isCommandId(id)) return memory;
  return { ...memory, history: [{ id, at }, ...memory.history].slice(0, MAX_HISTORY) };
}
function toggleFavorite(memory, id) {
  if (!isCommandId(id)) return memory;
  const favorites = memory.favorites.includes(id) ? memory.favorites.filter((f) => f !== id) : [...memory.favorites, id].slice(-MAX_FAVORITES);
  return { ...memory, favorites };
}
function recentIds(memory, limit) {
  const seen = [];
  for (const entry of memory.history) {
    if (!seen.includes(entry.id)) seen.push(entry.id);
    if (seen.length >= limit) break;
  }
  return seen;
}

// src/center/fuzzy.ts
var SCORE_MATCH = 1;
var SCORE_CONSECUTIVE = 2;
var SCORE_WORD_START = 3;
var SCORE_PREFIX = 5;
var PENALTY_GAP = 0.1;
var isWordStart = (text, index) => index === 0 || /[\s\-_/.:]/.test(text.charAt(index - 1));
function matchFrom(query, text, start) {
  const indices = [];
  let score = 0;
  let cursor = start;
  for (let q = 0; q < query.length; q++) {
    const char = query.charAt(q);
    let found = q === 0 ? start : -1;
    for (let i = cursor; q > 0 && i < text.length; i++) {
      if (text.charAt(i) !== char) continue;
      if (found === -1) found = i;
      if (i === cursor || isWordStart(text, i)) {
        found = i;
        break;
      }
    }
    if (found === -1) return void 0;
    score += SCORE_MATCH;
    const previous = indices.at(-1);
    if (previous !== void 0 && found === previous + 1) score += SCORE_CONSECUTIVE;
    else if (previous !== void 0) score -= (found - previous - 1) * PENALTY_GAP;
    if (isWordStart(text, found)) score += SCORE_WORD_START;
    indices.push(found);
    cursor = found + 1;
  }
  if (indices[0] === 0 && indices.every((position, i) => position === i)) score += SCORE_PREFIX;
  return { score, indices };
}
function fuzzyMatch(query, text) {
  const q = query.trim().toLowerCase();
  if (q === "") return { score: 0, indices: [] };
  const t = text.toLowerCase();
  let best;
  for (let start = t.indexOf(q.charAt(0)); start !== -1; start = t.indexOf(q.charAt(0), start + 1)) {
    const candidate = matchFrom(q, t, start);
    if (candidate !== void 0 && (best === void 0 || candidate.score > best.score)) best = candidate;
  }
  return best;
}

// src/center/palette.ts
var MAX_JUMP = 99;
var MAX_ARGS_LENGTH = 500;
function normalize(raw) {
  let text = raw.trim();
  if (text.startsWith("/")) text = text.slice(1);
  const lower = text.toLowerCase();
  if (lower.startsWith("jpe:")) return text.slice(4).trimStart();
  if (lower.startsWith("jpe ")) return text.slice(4).trimStart();
  return text;
}
function parseQuery(raw) {
  const text = normalize(raw);
  if (/^\d{1,2}$/.test(text)) {
    const n = Number.parseInt(text, 10);
    if (n >= 1 && n <= MAX_JUMP) return { kind: "jump", index: n - 1 };
  }
  const space = text.search(/\s/);
  if (space > 0) {
    const first = text.slice(0, space).toLowerCase();
    const args = text.slice(space).trim();
    if (findCommand(first) !== void 0 && args !== "") return { kind: "run", commandId: first, args: args.slice(0, MAX_ARGS_LENGTH) };
  }
  return { kind: "search", text };
}
function defaultOrder(memory) {
  const ordered = [];
  const push = (id) => {
    const found = findCommand(id);
    if (found !== void 0 && !ordered.includes(found)) ordered.push(found);
  };
  for (const id of memory.favorites) push(id);
  for (const id of recentIds(memory, CENTER_COMMANDS.length)) push(id);
  for (const c of CENTER_COMMANDS) push(c.id);
  return ordered;
}
var RECENCY_BONUS = 3;
var RECENCY_STEP = 0.5;
var FAVORITE_BONUS = 4;
function bestScore(query, c) {
  const fields = [[c.title, 1], [c.id, 1.2], ...c.keywords.map((k) => [k, 0.8]), [c.summary, 0.4]];
  let best;
  for (const [text, weight] of fields) {
    const match = fuzzyMatch(query, text);
    if (match === void 0) continue;
    const weighted = match.score * weight;
    if (best === void 0 || weighted > best) best = weighted;
  }
  return best;
}
function rankCommands(rawQuery, memory) {
  const parsed = parseQuery(rawQuery);
  const recent = recentIds(memory, CENTER_COMMANDS.length);
  const lastUsed = (id) => memory.history.find((h2) => h2.id === id)?.at;
  const entryFor = (command2, score, titleMatch) => {
    const used = lastUsed(command2.id);
    return { command: command2, score, titleMatch, isFavorite: memory.favorites.includes(command2.id), ...used === void 0 ? {} : { lastUsed: used } };
  };
  if (parsed.kind !== "search" || parsed.text === "") {
    const order = defaultOrder(memory);
    const target = parsed.kind === "run" ? findCommand(parsed.commandId) : void 0;
    const list = target === void 0 ? order : [target, ...order.filter((c) => c !== target)];
    return list.map((c) => entryFor(c, 0, []));
  }
  const results = [];
  CENTER_COMMANDS.forEach((command2) => {
    const score = bestScore(parsed.text, command2);
    if (score === void 0) return;
    const recency = recent.indexOf(command2.id);
    const bonus = (memory.favorites.includes(command2.id) ? FAVORITE_BONUS : 0) + (recency === -1 ? 0 : Math.max(0, RECENCY_BONUS - recency * RECENCY_STEP));
    results.push(entryFor(command2, score + bonus, fuzzyMatch(parsed.text, command2.title)?.indices ?? []));
  });
  return results.sort((a, b) => b.score - a.score);
}
function resolveSubmit(rawQuery, entries) {
  const parsed = parseQuery(rawQuery);
  if (parsed.kind === "run") return { ok: true, commandId: parsed.commandId, args: parsed.args };
  if (parsed.kind === "jump") {
    const entry = entries[parsed.index];
    return entry === void 0 ? { ok: false, message: `There is no item ${parsed.index + 1} in the list.` } : { ok: true, commandId: entry.command.id, args: "" };
  }
  const top = entries[0];
  return top === void 0 ? { ok: false, message: `No command matches "${parsed.text}".` } : { ok: true, commandId: top.command.id, args: "" };
}

// src/center/suggestions.ts
var MAX_SUGGESTIONS = 5;
var LEVEL_ORDER = { error: 0, warning: 1, info: 2 };
var BASIS_ORDER = { confirmed: 0, suggestion: 1 };
function suggest(hud) {
  const out = [];
  const v = hud.verification;
  if (v.problem !== void 0) {
    out.push({ id: "verification-record-damaged", commandId: "verify", title: "Run the checks again", why: v.problem, basis: "confirmed", level: "warning" });
  } else if (v.status === "FAILED") {
    out.push({ id: "verification-failed", commandId: "fix", title: "Fix the failing checks", why: `The last verification FAILED${v.reasons[0] === void 0 ? "." : `: ${v.reasons[0]}`}`, basis: "confirmed", level: "error" });
  } else if (v.status === "BLOCKED") {
    out.push({ id: "verification-blocked", commandId: "status", title: "See what is blocking verification", why: `The last verification is BLOCKED${v.reasons[0] === void 0 ? "." : `: ${v.reasons[0]}`}`, basis: "confirmed", level: "error" });
  } else if (v.status === "PARTIALLY_VERIFIED" || v.status === "FUNCTIONAL_WITH_WARNINGS") {
    out.push({ id: "verification-incomplete", commandId: "status", title: "See what is not fully verified", why: `The last verification is ${v.status}${v.reasons[0] === void 0 ? "." : `: ${v.reasons[0]}`}`, basis: "confirmed", level: "warning" });
  } else if (v.status === "NOT_TESTED" && v.checksAvailable.length > 0) {
    out.push({ id: "verification-not-run", commandId: "verify", title: "Run the project's checks", why: `Nothing has been verified yet, and this project has: ${v.checksAvailable.join(", ")}.`, basis: "confirmed", level: "info" });
  }
  if (hud.languageServersMissing.length > 0) {
    out.push({ id: "language-servers-missing", commandId: "setup", title: "Set up language servers", why: `Not installed: ${hud.languageServersMissing.join(", ")}. Without one, nothing is checked by the language server.`, basis: "confirmed", level: "warning" });
  }
  const alreadyVerifying = out.some((s) => s.commandId === "verify");
  if (hud.git.state === "dirty" && v.checksAvailable.length > 0 && v.status !== "FAILED" && !alreadyVerifying) {
    const n = hud.git.changedFiles;
    out.push({ id: "uncommitted-changes", commandId: "verify", title: "Verify before you commit", why: `${n} uncommitted ${n === 1 ? "file" : "files"}. This is a habit, not a finding: JPE cannot tell whether the last verification covers them.`, basis: "suggestion", level: "info" });
  }
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || BASIS_ORDER[a.basis] - BASIS_ORDER[b.basis]).slice(0, MAX_SUGGESTIONS);
}
var notifications = (hud) => suggest(hud).filter((s) => s.basis === "confirmed" && s.level !== "info");

// src/center/home.ts
var MAX_NUMBERED = 9;
function formatAge(iso, now) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "at an unknown time";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1e3));
  if (seconds < 60) return "just now";
  const unit = (n, word) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return unit(Math.floor(seconds / 3600), "hour");
  return unit(Math.floor(seconds / 86400), "day");
}
var actionFor = (n, command2, tag, detail, extra = {}) => ({
  n,
  commandId: command2.id,
  args: extra.args ?? "",
  slash: `/${command2.slash}`,
  title: command2.title,
  detail,
  tag,
  changesThings: command2.changesThings,
  ...extra.basis === void 0 ? {} : { basis: extra.basis },
  ...extra.level === void 0 ? {} : { level: extra.level }
});
function homeActions(hud, memory) {
  const actions = [];
  const has = (id) => actions.some((a) => a.commandId === id);
  const add = (command2, tag, detail, extra = {}) => {
    if (command2 === void 0 || has(command2.id) || actions.length >= MAX_NUMBERED) return;
    actions.push(actionFor(actions.length + 1, command2, tag, detail, extra));
  };
  for (const s of suggest(hud)) add(findCommand(s.commandId), "next", `${s.title}. ${s.why}`, { basis: s.basis, level: s.level, ...s.args === void 0 ? {} : { args: s.args } });
  for (const id of memory.favorites) add(findCommand(id), "favorite", findCommand(id)?.summary ?? "");
  for (const id of recentIds(memory, MAX_NUMBERED)) add(findCommand(id), "recent", findCommand(id)?.summary ?? "");
  for (const c of CENTER_COMMANDS) add(c, "command", c.summary);
  return actions;
}
var TAG_WORDS = { next: "next step", favorite: "favorite", recent: "recent", command: "" };
function gitText(hud) {
  switch (hud.git.state) {
    case "unavailable":
      return "git is not installed";
    case "not-repo":
      return "not a git repository";
    case "clean":
      return `branch ${hud.git.branch}, no uncommitted changes`;
    case "dirty":
      return `branch ${hud.git.branch}, ${hud.git.changedFiles} uncommitted ${hud.git.changedFiles === 1 ? "file" : "files"}`;
  }
}
function hudLines(hud, profile, now) {
  const label = (text) => [span(text, { role: "muted" })];
  const project = [inline(hud.project.name), hud.project.ecosystems.length === 0 ? "no recognised language" : hud.project.ecosystems.join(", ") + (hud.project.packageManager === void 0 ? "" : ` (${hud.project.packageManager})`)].join(" \xB7 ");
  const v = hud.verification;
  const age = v.at === void 0 ? "never run" : `last run ${formatAge(v.at, now)}`;
  const servers = hud.languageServersMissing.length === 0 ? "all found" : `missing: ${hud.languageServersMissing.join(", ")}`;
  const mode = `${hud.runtime.offline ? "offline (documentation from the cache only)" : "online"} \xB7 approvals: ${hud.runtime.approval}`;
  const rows = [
    ["Project", project],
    ["Git", gitText(hud)],
    ["Language servers", servers],
    ["Mode", mode]
  ];
  const keyWidth = Math.max(...rows.map(([k]) => displayWidth(k)), displayWidth("Verification"));
  const wide = profile.width >= 50 && !profile.screenReader;
  const valueWidth = Math.max(8, profile.width - keyWidth - 2);
  const out = rows.flatMap(([key, value]) => {
    if (!wide) return [label(key), ...textLines(value, profile.width - 2).map((l) => [span("  "), ...l])];
    return textLines(value, valueWidth).map((l, n) => [span(n === 0 ? pad(key, keyWidth) : " ".repeat(keyWidth), { role: "muted" }), span("  "), ...l]);
  });
  out.push(label("Verification"));
  out.push(...verificationBadge(v.status, profile).map((l) => [span("  "), ...l]));
  out.push(...textLines(age, profile.width - 2, { role: "muted" }).map((l) => [span("  "), ...l]));
  for (const reason of v.reasons) out.push(...textLines(reason, profile.width - 2, { role: "muted" }).map((l) => [span("  "), ...l]));
  if (v.problem !== void 0) out.push(...textLines(v.problem, profile.width - 2, { role: "warning" }).map((l) => [span("  "), ...l]));
  return out;
}
function actionBody(a, profile) {
  const indent = (lines) => lines.map((l) => [span("   "), ...l]);
  const notes = [a.changesThings ? "asks first" : "", TAG_WORDS[a.tag]].filter((n) => n !== "").join(" \xB7 ");
  const why = a.basis === void 0 ? a.detail : `${a.detail} (${a.basis})`;
  const width = Math.max(8, profile.width - 3);
  return [...indent(notes === "" ? [] : textLines(notes, width, { role: "muted" })), ...indent(textLines(why, width, { role: "muted" }))];
}
var actionHead = (a) => [span(`${a.n}. `, { role: "muted" }), span(a.slash, { role: "accent", bold: true })];
function actionLines(actions, profile) {
  return actions.flatMap((a) => [actionHead(a), ...actionBody(a, profile)]);
}
function statusLineText(hud) {
  const parts = [`JPE: ${hud.verification.status}`];
  if (hud.git.state === "dirty") parts.push(`${hud.git.branch} +${hud.git.changedFiles} changed`);
  else if (hud.git.state === "clean") parts.push(hud.git.branch);
  if (hud.languageServersMissing.length > 0) parts.push(`${hud.languageServersMissing.length} language ${hud.languageServersMissing.length === 1 ? "server" : "servers"} missing`);
  if (hud.runtime.offline) parts.push("offline");
  return parts.join(" \xB7 ");
}
function buildHome(hud, memory, profile, now) {
  const actions = homeActions(hud, memory);
  const unnumbered = CENTER_COMMANDS.filter((c) => !actions.some((a) => a.commandId === c.id));
  return [
    ...heading("JPE command center", profile),
    ...hudLines(hud, profile, now),
    blank(),
    ...heading("What to do", profile),
    ...actionLines(actions, profile),
    ...unnumbered.length === 0 ? [] : [blank(), ...heading("Also available", profile), ...bulletList(unnumbered.map((c) => `/${c.slash}${c.argHint === void 0 ? "" : ` ${c.argHint}`}: ${c.summary}`), profile)],
    blank(),
    ...bulletList(["Type /jpe on its own to open this again, or /jpe <command> to run one directly."], profile)
  ];
}
function buildPaletteText(query, memory, profile) {
  const entries = rankCommands(query, memory);
  if (entries.length === 0) return [...heading("Command palette", profile), plain(`No command matches "${inline(query)}".`)];
  const marker = profile.unicode ? "\u2605" : "*";
  const rows = entries.map((e, i) => [String(i + 1), `/${e.command.slash}${e.isFavorite ? ` ${marker}` : ""}`, e.command.summary]);
  return [...heading(query.trim() === "" ? "Command palette" : `Command palette: ${inline(query)}`, profile), ...table({ columns: [{ header: "#", align: "right", min: 2 }, { header: "Command", min: 10 }, { header: "What it does", min: 12 }], rows }, profile)];
}

// src/center/hud-data.ts
var HUD_VERSION = 1;
var STATUSES = /* @__PURE__ */ new Set(["VERIFIED", "FUNCTIONAL_WITH_WARNINGS", "PARTIALLY_VERIFIED", "FAILED", "BLOCKED", "NOT_TESTED"]);
var isRecord2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
function parseHud(raw) {
  if (!isRecord2(raw) || raw["hudVersion"] !== HUD_VERSION || typeof raw["generatedAt"] !== "string") return void 0;
  const { project, git, verification, runtime } = raw;
  if (!isRecord2(project) || typeof project["name"] !== "string" || !isStringArray(project["ecosystems"])) return void 0;
  if (!isRecord2(git) || !["unavailable", "not-repo", "clean", "dirty"].includes(String(git["state"]))) return void 0;
  if ((git["state"] === "clean" || git["state"] === "dirty") && typeof git["branch"] !== "string") return void 0;
  if (git["state"] === "dirty" && typeof git["changedFiles"] !== "number") return void 0;
  if (!isRecord2(verification) || !STATUSES.has(String(verification["status"])) || !isStringArray(verification["reasons"]) || !isStringArray(verification["checksAvailable"])) return void 0;
  if (verification["at"] !== void 0 && typeof verification["at"] !== "string") return void 0;
  if (verification["problem"] !== void 0 && typeof verification["problem"] !== "string") return void 0;
  if (!isStringArray(raw["languageServersMissing"])) return void 0;
  if (!isRecord2(runtime) || typeof runtime["offline"] !== "boolean" || !["risk-based", "always", "off"].includes(String(runtime["approval"]))) return void 0;
  return raw;
}

// src/ui/color.ts
var HEX_COLOR = /^#[0-9a-f]{6}$/i;
var isHexColor = (value) => HEX_COLOR.test(value);
function parseHex(hex) {
  if (!isHexColor(hex)) throw new RangeError(`Not a #RRGGBB colour: ${hex}`);
  return { r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16) };
}
function toAnsi256(hex) {
  const { r, g, b } = parseHex(hex);
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round((r - 8) / 247 * 23);
  }
  const level = (channel) => Math.round(channel / 255 * 5);
  return 16 + 36 * level(r) + 6 * level(g) + level(b);
}

// src/ui/paint.ts
var CSI2 = "\x1B[";
var RESET = `${CSI2}0m`;
var TERMINAL_STYLE_ROLES = {
  text: {},
  muted: { dim: true },
  heading: { bold: true, colorAs: "accent" },
  border: { dim: true },
  inactive: { dim: true }
};
function foregroundCode(profile, role) {
  if (profile.color === "none") return void 0;
  let colorRole = role;
  if (profile.surface === "terminal" && role in TERMINAL_STYLE_ROLES) {
    const treatment = TERMINAL_STYLE_ROLES[role];
    if (treatment?.colorAs === void 0) return void 0;
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
function resolveSpanStyle(profile, part) {
  const role = part.role ?? "text";
  const treatment = profile.surface === "terminal" ? TERMINAL_STYLE_ROLES[role] : void 0;
  const colorRole = treatment === void 0 ? role : treatment.colorAs;
  const color = profile.color === "none" || colorRole === void 0 ? void 0 : profile.theme.colors[colorRole];
  return { ...color === void 0 ? {} : { color }, bold: Boolean(part.bold || treatment?.bold), dim: Boolean(part.dim || treatment?.dim), underline: Boolean(part.underline) };
}
function sgrFor(profile, part) {
  if (!profile.styles) return "";
  const role = part.role ?? "text";
  const standIn = profile.surface === "terminal" ? TERMINAL_STYLE_ROLES[role] : void 0;
  const codes = [];
  if (part.bold || standIn?.bold) codes.push("1");
  if (part.dim || standIn?.dim) codes.push("2");
  if (part.underline) codes.push("4");
  const color = foregroundCode(profile, role);
  if (color) codes.push(color);
  return codes.join(";");
}
function paintLine(line, profile) {
  let out = "";
  for (const part of line) {
    const text = sanitize(part.text).replace(/\n/g, " ");
    if (text === "") continue;
    const sgr = sgrFor(profile, part);
    out += sgr === "" ? text : `${CSI2}${sgr}m${text}${RESET}`;
  }
  return out;
}
function paint(lines, profile) {
  return lines.map((line) => paintLine(line, profile)).join("\n");
}

// src/ui/capabilities.ts
var MIN_COLUMNS = 20;
var MAX_COLUMNS = 500;

// src/ui/symbols.ts
var UNICODE_SYMBOLS = {
  status: { success: "\u2714", warning: "\u25B2", error: "\u2718", info: "\u25C6", inactive: "\u25CB", pending: "\u2026" },
  box: { topLeft: "\u256D", topRight: "\u256E", bottomLeft: "\u2570", bottomRight: "\u256F", horizontal: "\u2500", vertical: "\u2502", separator: "\u2502" },
  barFull: "\u2588",
  barEmpty: "\u2591",
  ellipsis: "\u2026",
  bullet: "\u2022",
  arrow: "\u2192"
};
var ASCII_SYMBOLS = {
  status: { success: "+", warning: "!", error: "x", info: "i", inactive: "-", pending: "~" },
  box: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|", separator: "|" },
  barFull: "#",
  barEmpty: "-",
  ellipsis: "...",
  bullet: "*",
  arrow: "->"
};
var symbolsFor = (unicode) => unicode ? UNICODE_SYMBOLS : ASCII_SYMBOLS;

// src/ui/tokens.ts
var ANSI16_DARK = { text: 7, muted: 8, heading: 13, accent: 13, success: 10, warning: 11, error: 9, info: 12, inactive: 8, pending: 14, border: 8 };
var ANSI16_LIGHT = { text: 0, muted: 8, heading: 5, accent: 5, success: 2, warning: 3, error: 1, info: 4, inactive: 8, pending: 6, border: 8 };
var THEMES = {
  jpe: {
    name: "jpe",
    description: "The JPE identity: near-black background, violet accent.",
    mode: "dark",
    background: "#121212",
    surface: "#292929",
    colors: {
      text: "#F0F0F0",
      muted: "#BDBDBD",
      heading: "#FAFAFA",
      accent: "#9B6DFF",
      success: "#5FD38D",
      warning: "#F2B84B",
      error: "#FF6B6B",
      info: "#5CB8FF",
      inactive: "#8A8A8A",
      pending: "#8FBCD4",
      border: "#8A8A8A"
    },
    ansi16: ANSI16_DARK
  },
  "jpe-contrast": {
    name: "jpe-contrast",
    description: "High contrast: black background, every text role at least 7:1 (WCAG AAA).",
    mode: "dark",
    background: "#000000",
    surface: "#1A1A1A",
    colors: {
      text: "#FFFFFF",
      muted: "#E6E6E6",
      heading: "#FFFFFF",
      accent: "#CDB4FF",
      success: "#7CFFB2",
      warning: "#FFD866",
      error: "#FF8A8A",
      info: "#8CD2FF",
      inactive: "#BFBFBF",
      pending: "#B3E5FC",
      border: "#BFBFBF"
    },
    ansi16: ANSI16_DARK
  },
  "jpe-colorblind": {
    name: "jpe-colorblind",
    description: "Colour-blind safe: status hues from the Okabe-Ito palette (blue, yellow, reddish purple) instead of green and red.",
    mode: "dark",
    background: "#121212",
    surface: "#292929",
    colors: {
      text: "#F0F0F0",
      muted: "#BDBDBD",
      heading: "#FAFAFA",
      accent: "#9B6DFF",
      success: "#56B4E9",
      warning: "#F0E442",
      error: "#E58BBB",
      info: "#E6E6E6",
      inactive: "#8A8A8A",
      pending: "#3DD6A5",
      border: "#8A8A8A"
    },
    ansi16: { ...ANSI16_DARK, success: 12, warning: 11, error: 13, info: 15, pending: 14 }
  },
  "jpe-light": {
    name: "jpe-light",
    description: "For light terminal backgrounds.",
    mode: "light",
    background: "#FAFAFA",
    surface: "#EDEDED",
    colors: {
      text: "#1A1A1A",
      muted: "#4A4A4A",
      heading: "#000000",
      accent: "#6B3FD4",
      success: "#12703E",
      warning: "#8A5A00",
      error: "#B3261E",
      info: "#0B5FA5",
      inactive: "#6B6B6B",
      pending: "#2E6F8E",
      border: "#6B6B6B"
    },
    ansi16: ANSI16_LIGHT
  }
};

// src/ui/profile.ts
var DEFAULT_UI_SETTINGS = { theme: "jpe", color: "auto", unicode: "auto", density: "auto", motion: "auto", screenReader: false, navigation: "both", shortcuts: {} };
function resolveProfile(caps, settings, overrides = {}) {
  const width = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.trunc(overrides.width ?? caps.columns)));
  const color = settings.color === "auto" ? caps.color : settings.color;
  const unicode = settings.unicode === "auto" ? caps.unicode : settings.unicode === "on";
  const density = settings.density === "auto" ? width < 80 || caps.rows < 24 ? "compact" : "comfortable" : settings.density;
  const motion = settings.motion === "auto" ? caps.reducedMotion ? "reduced" : "full" : settings.motion;
  return {
    theme: THEMES[settings.theme],
    color,
    // An explicit colour setting means the person wants styling even where detection said "not a terminal".
    styles: caps.styles || settings.color !== "auto" && settings.color !== "none",
    unicode,
    symbols: symbolsFor(unicode),
    width,
    density,
    motion,
    screenReader: settings.screenReader || caps.screenReader,
    surface: overrides.surface ?? "terminal",
    keymap: buildKeymap(settings.navigation, settings.shortcuts)
  };
}

// src/mod/center.tsx
var PANE = "jpe-center";
var MEMORY_KEY = "center-memory";
var HUD_TIMEOUT_MS = 2e4;
var MAX_TOAST_CHARS = 200;
var MIN_PANE_COLUMNS = 24;
var MIN_REFRESH_GAP_MS = 5e3;
var DEFAULT_COLUMNS = 80;
var hudState = atom({ plugin: "jpe", key: "hud" }, null, { shape: "hud-1" });
var queryState = atom({ plugin: "jpe", key: "query" }, "");
var pendingState = atom({ plugin: "jpe", key: "pending" }, null, { shape: "pending-1" });
var noticeState = atom({ plugin: "jpe", key: "notice" }, "");
var memoryState = atom({ plugin: "jpe", key: "memory" }, EMPTY_MEMORY, { shape: "memory-1" });
var toasted = /* @__PURE__ */ new Set();
var refreshing;
var lastRefreshAt = 0;
var capabilities = (columns, plain2) => ({
  color: plain2 ? "none" : "truecolor",
  styles: !plain2,
  unicode: true,
  columns,
  rows: 30,
  interactive: !plain2,
  remote: false,
  ci: false,
  reducedMotion: false,
  screenReader: false,
  reasons: []
});
var paneProfile = (columns) => resolveProfile(capabilities(columns, false), { ...DEFAULT_UI_SETTINGS, density: "compact" }, { surface: "own" });
var textProfile = (columns) => resolveProfile(capabilities(columns, true), DEFAULT_UI_SETTINGS);
var background = (work) => {
  work.catch(() => void 0);
};
var messageOf = (error) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
async function currentMemory($) {
  return parseMemory(await read($, memoryState));
}
async function changeMemory($, change) {
  await update($, memoryState, (value) => change(parseMemory(value)));
  await $.store.set(MEMORY_KEY, await currentMemory($));
}
async function say($, text) {
  await update($, noticeState, () => text);
}
async function refreshHud($) {
  if (refreshing !== void 0) return refreshing;
  refreshing = (async () => {
    try {
      const result = await $.process.run(["node", `${$.plugin.root}/dist/cli.js`, "center", "hud", "--json"], { timeoutMs: HUD_TIMEOUT_MS });
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `the command exited with code ${result.exitCode}`);
      const data = parseHud(JSON.parse(result.stdout));
      if (data === void 0) throw new Error("the project facts were in a format this version of JPE does not understand");
      await update($, hudState, () => data);
      lastRefreshAt = Date.now();
      await update($, noticeState, (previous) => previous.startsWith("Could not read") ? "" : previous);
      announce($, data);
      return data;
    } catch (error) {
      await say($, `Could not read this project's facts: ${messageOf(error)}. Run /jpe:setup to check JPE.`);
      return void 0;
    } finally {
      refreshing = void 0;
    }
  })();
  return refreshing;
}
function announce($, data) {
  $.ui.status(statusLineText(data));
  const fresh = notifications(data).find((n) => !toasted.has(n.id));
  if (fresh === void 0) return;
  toasted.add(fresh.id);
  $.ui.toast(`${fresh.title}: ${fresh.why}`.slice(0, MAX_TOAST_CHARS));
}
async function launch($, commandId, args, confirmed = false) {
  const command2 = findCommand(commandId);
  if (command2 === void 0) {
    await say($, `There is no JPE command called "${commandId}".`);
    return;
  }
  if (command2.changesThings && !confirmed) {
    await update($, pendingState, () => ({ commandId, args }));
    await say($, "");
    return;
  }
  await update($, pendingState, () => null);
  try {
    await changeMemory($, (memory) => recordUse(memory, command2.id, new Date(Date.now()).toISOString()));
    await $.command.run({ command: command2.slash, args });
    await say($, `Ran /${command2.slash}${args === "" ? "" : ` ${args}`}.`);
  } catch (error) {
    await say($, `Could not run /${command2.slash}: ${messageOf(error)}`);
  }
}
async function submitQuery($, raw) {
  const memory = await currentMemory($);
  const submission = resolveSubmit(raw, rankCommands(raw, memory));
  if (!submission.ok) {
    await say($, submission.message);
    return;
  }
  await update($, queryState, () => "");
  await launch($, submission.commandId, submission.args);
}
async function recordTyped($, command2, args) {
  const id = command2 === "jpe:jpe" ? args.trim().split(/\s+/)[0]?.toLowerCase() : command2.startsWith("jpe:") ? command2.slice(4) : void 0;
  if (id === void 0 || findCommand(id) === void 0) return;
  await changeMemory($, (memory) => recordUse(memory, id, new Date(Date.now()).toISOString()));
}
async function openCenter($, columns) {
  const data = await refreshHud($);
  const placed = await $.ui.open({ id: PANE, title: "JPE", focus: true, closeOnEscape: true });
  if (placed.isPlaced) {
    return { text: "JPE command center opened. Press 1 to 9 to pick an item, Tab to move, Enter to choose, Esc to close it.", isTextDisplayOnly: true };
  }
  const profile = textProfile(columns);
  const memory = await currentMemory($);
  if (data === void 0) {
    const reason = await read($, noticeState);
    return { text: paint([...heading("JPE command center", profile), ...textLines(reason === "" ? "Could not read this project's facts." : reason, columns), ...buildPaletteText("", memory, profile)], profile), isTextDisplayOnly: true };
  }
  return { text: paint(buildHome(data, memory, profile, new Date(Date.now())), profile), isTextDisplayOnly: true };
}
function register(on) {
  on("session.start", async ($, e, next) => {
    try {
      const stored = await $.store.get(MEMORY_KEY);
      await update($, memoryState, () => parseMemory(stored));
    } catch {
    }
    background(refreshHud($));
    return next(e);
  });
  on("turn.complete", async ($, e, next) => {
    if (Date.now() - lastRefreshAt >= MIN_REFRESH_GAP_MS) background(refreshHud($));
    return next(e);
  });
  on("command.run", async ($, e, next) => {
    const args = e.args ?? "";
    if (e.command === "jpe:jpe" && args.trim() === "") return openCenter($, e.presentation?.columns ?? DEFAULT_COLUMNS);
    background(recordTyped($, e.command, args));
    return next({ ...e, args });
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e);
    const columns = Math.max(MIN_PANE_COLUMNS, e.props.bodyColumns);
    const profile = paneProfile(columns);
    const colors = profile.theme.colors;
    const data = parseHud(await read($, hudState));
    const memory = parseMemory(await read($, memoryState));
    const query = await read($, queryState);
    const pending = await read($, pendingState);
    const notice = await read($, noticeState);
    const row = (line) => /* @__PURE__ */ h(Box, { flexDirection: "row" }, line.map((part) => {
      const style = resolveSpanStyle(profile, part);
      return /* @__PURE__ */ h(Text, { color: style.color ?? colors.text, bold: style.bold, dimColor: style.dim }, part.text === "" ? " " : part.text);
    }));
    const rows = (lines) => lines.map(row);
    const now = new Date(Date.now());
    const actions = data === void 0 ? [] : homeActions(data, memory);
    const entries = rankCommands(query, memory);
    const top = entries[0];
    const parsed = parseQuery(query);
    const confirm = pending === null ? [] : [
      /* @__PURE__ */ h(Box, { flexDirection: "column" }, rows(textLines(`/${findCommand(pending.commandId)?.slash ?? pending.commandId}${pending.args === "" ? "" : ` ${pending.args}`} can change files, settings or installed software in this project. Run it?`, columns - 2, { role: "warning", bold: true })), /* @__PURE__ */ h(Button, { key: "confirm-run", hotkey: "y", label: "y  Yes, run it", onPress: () => background(launch($, pending.commandId, pending.args, true)) }), /* @__PURE__ */ h(Button, { key: "confirm-cancel", hotkey: "n", label: "n  Cancel", onPress: () => background(update($, pendingState, () => null)) }))
    ];
    return /* @__PURE__ */ h(Box, { flexDirection: "column", backgroundColor: profile.theme.background }, rows(heading("JPE command center", profile)), data === void 0 ? rows(textLines(notice === "" ? "Reading this project's facts\u2026" : notice, columns - 2, { role: "muted" })) : rows(hudLines(data, profile, now)), rows(heading("What to do", profile)), actions.map((a) => /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Button, { key: `action-${a.n}`, hotkey: String(a.n), label: `${actionHead(a).map((s) => s.text).join("")}`, onPress: () => background(launch($, a.commandId, a.args)) }), rows(actionBody(a, profile)))), confirm, /* @__PURE__ */ h(Input, { key: "palette", label: "Command", placeholder: "search, an item number, or a command and what to give it", value: query, onInput: (v) => background(update($, queryState, () => v)), onSubmit: (v) => background(submitQuery($, v)) }), query.trim() !== "" && entries.length > 0 ? /* @__PURE__ */ h(
      Select,
      {
        key: "results",
        label: "Matches",
        value: top?.command.id,
        options: entries.slice(0, 9).map((entry, i) => ({ value: entry.command.id, label: `${i + 1}  /${entry.command.slash}${entry.isFavorite ? " \u2605" : ""}  ${entry.command.summary}` })),
        onSelect: (id) => background(launch($, id, parsed.kind === "run" && parsed.commandId === id ? parsed.args : ""))
      }
    ) : null, query.trim() !== "" && entries.length === 0 ? rows(textLines(`No command matches "${query.trim()}".`, columns - 2, { role: "warning" })) : null, top !== void 0 && query.trim() !== "" ? /* @__PURE__ */ h(Button, { key: "favorite", hotkey: "f", label: `f  ${top.isFavorite ? "Remove" : "Add"} /${top.command.slash} ${top.isFavorite ? "from" : "to"} favorites`, onPress: () => background(changeMemory($, (m) => toggleFavorite(m, top.command.id))) }) : null, notice !== "" && data !== void 0 ? rows(textLines(notice, columns - 2, { role: "muted" })) : null, rows(textLines("Number keys pick an item. Tab and the arrow keys move, Enter chooses, Esc closes.", columns - 2, { role: "muted" })));
  });
}
export {
  register
};

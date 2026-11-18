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
  command("resume", "Resume", "Where you left off: project facts, the last session and your open tasks", "Manage", false, ["continue", "pick up", "last time", "where was i", "tasks", "todo"]),
  command("agents", "Agents", "See which agents Claude Code started and stopped, and how long they took", "Check", false, ["subagent", "running", "parallel", "tasks", "who is working"]),
  command("review", "Review", "Review the uncommitted changes: what changed, possible risks, and what to confirm", "Check", false, ["changes", "diff", "pull request", "approve", "reject", "look over", "before commit"], "<path>"),
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
var ROLE_WORDS = { success: "OK", warning: "Warning", error: "Error", info: "Note", inactive: "Inactive", pending: "Pending" };
function badgeLines(text, role, profile) {
  return wrapText(text, profile.width).map((line) => [span(line, { role, bold: true })]);
}
function statusBadge(role, label, profile) {
  const text = inline(label);
  return badgeLines(profile.screenReader ? `${ROLE_WORDS[role]}: ${text}` : `${profile.symbols.status[role]} ${text}`, role, profile);
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

// src/agents/runs.ts
var STALE_AFTER_MS = 30 * 60 * 1e3;
function agentsSentence(summary) {
  if (summary.total === 0) return "No agent activity has been recorded in this project.";
  const parts = [`${summary.running} running`, `${summary.total} recorded`];
  if (summary.noStopSeen > 0) parts.push(`${summary.noStopSeen} with no stop seen`);
  return parts.join(", ");
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
  const r = hud.review;
  if (r !== void 0 && r.changedFiles > 0) {
    const files = `${r.changedFiles} uncommitted ${r.changedFiles === 1 ? "file" : "files"}`;
    if (r.state === "none") out.push({ id: "review-pending", commandId: "review", title: "Review the uncommitted changes", why: `${files}, and no review decision has been recorded for them.`, basis: "confirmed", level: "info" });
    else if (r.state === "stale") out.push({ id: "review-stale", commandId: "review", title: "Review again: files changed since the last decision", why: `The last decision (${r.decision ?? "recorded"}) was about different changes than the current ${files}.`, basis: "confirmed", level: "info" });
    else if (r.decision === "rejected") out.push({ id: "review-rejected", commandId: "review", title: "The current changes were rejected in review", why: `The recorded decision about the current ${files} is "rejected".`, basis: "confirmed", level: "warning" });
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
function reviewText(review, now) {
  const when = review.at === void 0 ? "" : formatAge(review.at, now);
  if (review.state === "none") return "no decision recorded for these changes";
  if (review.state === "stale") return `last decision (${review.decision ?? "recorded"} ${when}) is stale: files changed since`;
  return `${review.decision ?? "decided"} ${when}, and the changes are unchanged since`;
}
function hudLines(hud, profile, now) {
  const label = (text) => [span(text, { role: "muted" })];
  const project = [inline(hud.project.name), hud.project.ecosystems.length === 0 ? "no recognised language" : hud.project.ecosystems.join(", ") + (hud.project.packageManager === void 0 ? "" : ` (${hud.project.packageManager})`)].join(` ${profile.symbols.dot} `);
  const v = hud.verification;
  const age = v.at === void 0 ? "never run" : `last run ${formatAge(v.at, now)}`;
  const servers = hud.languageServersMissing.length === 0 ? "all found" : `missing: ${hud.languageServersMissing.join(", ")}`;
  const mode = `${hud.runtime.offline ? "offline (documentation from the cache only)" : "online"} ${profile.symbols.dot} approvals: ${hud.runtime.approval}`;
  const rows = [
    ["Project", project],
    ["Git", gitText(hud)],
    ...hud.review === void 0 || hud.review.changedFiles === 0 ? [] : [["Review", reviewText(hud.review, now)]],
    ...(hud.openTasks ?? 0) === 0 ? [] : [["Tasks", `${hud.openTasks} open`]],
    ...hud.agents === void 0 ? [] : [["Agents", agentsSentence(hud.agents)]],
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
  const notes = [a.changesThings ? "asks first" : "", TAG_WORDS[a.tag]].filter((n) => n !== "").join(` ${profile.symbols.dot} `);
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
  const review = raw["review"];
  if (review !== void 0) {
    if (!isRecord2(review) || typeof review["changedFiles"] !== "number" || !Number.isInteger(review["changedFiles"]) || review["changedFiles"] < 0) return void 0;
    if (!["none", "current", "stale"].includes(String(review["state"]))) return void 0;
    if (review["decision"] !== void 0 && !["approved", "rejected"].includes(String(review["decision"]))) return void 0;
    if (review["at"] !== void 0 && typeof review["at"] !== "string") return void 0;
  }
  const openTasks = raw["openTasks"];
  if (openTasks !== void 0 && !(typeof openTasks === "number" && Number.isInteger(openTasks) && openTasks > 0)) return void 0;
  const agents = raw["agents"];
  if (agents !== void 0) {
    const count = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
    if (!isRecord2(agents) || !count(agents["running"]) || !count(agents["total"]) || !count(agents["noStopSeen"])) return void 0;
  }
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
  arrow: "\u2192",
  dot: "\xB7"
};
var ASCII_SYMBOLS = {
  status: { success: "+", warning: "!", error: "x", info: "i", inactive: "-", pending: "~" },
  box: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|", separator: "|" },
  barFull: "#",
  barEmpty: "-",
  ellipsis: "...",
  bullet: "*",
  arrow: "->",
  dot: "-"
};
var symbolsFor = (unicode) => unicode ? UNICODE_SYMBOLS : ASCII_SYMBOLS;

// src/ui/tokens.ts
var ANSI16_DARK = { text: 7, muted: 8, heading: 13, accent: 13, success: 10, warning: 11, error: 9, info: 12, inactive: 8, pending: 14, border: 8, keyword: 13, string: 10, comment: 8, number: 11 };
var ANSI16_LIGHT = { text: 0, muted: 8, heading: 5, accent: 5, success: 2, warning: 3, error: 1, info: 4, inactive: 8, pending: 6, border: 8, keyword: 5, string: 2, comment: 8, number: 3 };
var SYNTAX = {
  jpe: { keyword: "#C792EA", string: "#A5D6A7", comment: "#9AA5B1", number: "#F78C6C" },
  "jpe-contrast": { keyword: "#DDB8FF", string: "#B9F5BD", comment: "#C8D0D8", number: "#FFB59A" },
  "jpe-colorblind": { keyword: "#8FA8FF", string: "#E8D88A", comment: "#9AA5B1", number: "#FFA66B" },
  "jpe-light": { keyword: "#7A3EB8", string: "#1F6B3A", comment: "#5B6B7B", number: "#B14A00" }
};
var THEMES = {
  jpe: {
    name: "jpe",
    description: "The JPE identity: near-black background, violet accent.",
    mode: "dark",
    background: "#121212",
    surface: "#292929",
    colors: {
      ...SYNTAX["jpe"],
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
      ...SYNTAX["jpe-contrast"],
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
      ...SYNTAX["jpe-colorblind"],
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
      ...SYNTAX["jpe-light"],
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

// src/explain/glossary.ts
var GLOSSARY = [
  { term: "async/await", aliases: ["async", "await"], phrase: "waiting for slow work without freezing everything else (async/await)", plain: "A way to start slow work (a download, a database call) and let the program keep doing other things until the answer arrives; `await` marks the point where the code pauses for that one answer." },
  { term: "promise", aliases: ["promises"], phrase: "an IOU for a result that will arrive later (promise)", plain: "An object that stands for a value that is not ready yet. It later becomes either a finished result or a failure." },
  { term: "callback", aliases: ["callbacks"], phrase: "a function you hand over to be called when something finishes (callback)", plain: "A function passed to other code so that code can call it back when it is done or when an event happens." },
  { term: "closure", aliases: ["closures"], phrase: "a function that remembers the variables around where it was written (closure)", plain: "A function that keeps access to the variables that existed where it was created, even after that surrounding code has finished." },
  { term: "cache", aliases: ["caching", "cached"], phrase: "a saved copy kept nearby so it does not have to be fetched again (cache)", plain: "A stored copy of something expensive to get or compute, reused to make later requests faster. The risk is that the copy can go stale." },
  { term: "middleware", phrase: "a step that every request passes through on the way in (middleware)", plain: "Code that sits between a request arriving and the code that handles it, doing shared jobs such as logging or checking who you are." },
  { term: "ORM", phrase: "a layer that lets you work with database rows as normal objects (ORM)", plain: "Object-Relational Mapper: a library that translates between database tables and objects in your code, so you write less raw SQL." },
  { term: "race condition", aliases: ["race conditions"], phrase: "a bug where the result depends on which of two things happens to finish first (race condition)", plain: "A bug caused by two operations running at overlapping times where the outcome changes depending on timing." },
  { term: "deadlock", aliases: ["deadlocks"], phrase: "a standoff where two tasks each wait for the other forever (deadlock)", plain: "A situation where tasks are stuck because each holds something the other needs, so none can continue." },
  { term: "null pointer", aliases: ["null reference", "null dereference"], phrase: "using a value that turned out to be 'nothing' (null pointer)", plain: "An error that happens when code tries to use a value that is actually empty (null), as if it were a real thing." },
  { term: "undefined", phrase: "a variable that exists but was never given a value (undefined)", plain: "In JavaScript, the value of something that has not been assigned. Reading a property of it causes an error." },
  { term: "type inference", phrase: "the compiler working out a type for you without being told (type inference)", plain: "When the language figures out the type of a value from how it is used, so you do not have to write it out." },
  { term: "generics", aliases: ["generic", "generic type"], phrase: "code written once that works for many types, like a labelled box that can hold anything (generics)", plain: "A way to write functions or types that work with different kinds of data while still keeping the type checking." },
  { term: "dependency injection", phrase: "handing a piece of code the helpers it needs instead of letting it build them itself (dependency injection)", plain: "Passing in the things a component depends on from outside, which makes the component easy to test and swap." },
  { term: "idempotent", phrase: "safe to repeat: doing it twice has the same effect as once (idempotent)", plain: "An operation that gives the same end result no matter how many times you run it." },
  { term: "endpoint", aliases: ["endpoints", "route handler"], phrase: "a specific address a program can send requests to (endpoint)", plain: "One URL path on a server that accepts requests and returns a response." },
  { term: "API", phrase: "a menu of things one piece of software lets another piece ask it to do (API)", plain: "Application Programming Interface: the defined set of functions or requests that one program exposes for others to use." },
  { term: "REST", phrase: "a common style for web APIs built around addresses and standard actions like GET and POST (REST)", plain: "A convention for web APIs in which each thing has an address and you use standard HTTP actions to read or change it." },
  { term: "JSON", phrase: "a plain-text way of writing structured data (JSON)", plain: "JavaScript Object Notation: a text format for data made of named fields, lists, numbers, strings and true/false values." },
  { term: "serialization", aliases: ["serialize", "serializing", "deserialization", "deserialize"], phrase: "turning data into text or bytes so it can be saved or sent, and back again (serialization)", plain: "Converting in-memory data to a storable or sendable form (serialize), and the reverse (deserialize)." },
  { term: "parse", aliases: ["parsing", "parser"], phrase: "reading text and turning it into structured data the program can use (parsing)", plain: "Analysing text according to a format's rules and converting it into a structure the program can work with." },
  { term: "regex", aliases: ["regular expression", "regular expressions"], phrase: "a compact pattern for finding text (regular expression)", plain: "A short pattern language for matching and extracting pieces of text." },
  { term: "recursion", aliases: ["recursive"], phrase: "a function that solves a problem by calling itself on a smaller piece (recursion)", plain: "A technique where a function calls itself with simpler input until it reaches a case simple enough to answer directly." },
  { term: "memoization", aliases: ["memoize"], phrase: "remembering a function's answers so repeat questions are instant (memoization)", plain: "Caching the result of a function for given inputs so it is not recomputed." },
  { term: "hash map", aliases: ["hashmap", "dictionary", "hash table"], phrase: "a lookup table that finds a value quickly from its key (hash map)", plain: "A data structure that stores values under keys and can retrieve one without scanning everything." },
  { term: "index", aliases: ["database index", "indexes"], phrase: "a table of contents that lets the database find rows fast (index)", plain: "An extra structure the database keeps so searches on certain columns do not need to read every row. It speeds reads and slows writes slightly." },
  { term: "transaction", aliases: ["transactions"], phrase: "a group of database changes that either all happen or none do (transaction)", plain: "A set of operations treated as one unit: if any step fails, all of them are undone." },
  { term: "migration", aliases: ["migrations"], phrase: "a recorded step that changes the database's structure (migration)", plain: "A versioned script that updates a database schema (or data) from one shape to the next." },
  { term: "schema", phrase: "the blueprint describing what shape data is allowed to have (schema)", plain: "A formal description of the fields and types that data must follow." },
  { term: "mutex", aliases: ["lock", "locks"], phrase: "a key that only one task can hold at a time (mutex)", plain: "A lock that lets only one task use a shared resource at once, preventing them from stepping on each other." },
  { term: "thread", aliases: ["threads", "multithreading"], phrase: "one of several streams of work running side by side inside a program (thread)", plain: "A separate path of execution within a process that can run alongside others." },
  { term: "event loop", phrase: "the cycle that picks up the next waiting task and runs it (event loop)", plain: "The mechanism in JavaScript runtimes that repeatedly takes the next queued task or callback and runs it, one at a time." },
  { term: "stream", aliases: ["streams", "streaming"], phrase: "handling data piece by piece as it arrives instead of all at once (stream)", plain: "A way to process data in chunks, so large or endless data does not have to fit in memory." },
  { term: "call stack", aliases: ["stack trace"], phrase: "the list of functions that were in progress when something happened (call stack)", plain: "The ordered record of which function called which. A stack trace prints it when an error occurs, so you can follow the path to the problem." },
  { term: "garbage collection", aliases: ["garbage collector"], phrase: "automatic cleanup of memory nothing uses anymore (garbage collection)", plain: "The runtime's process of finding and freeing memory that the program can no longer reach." },
  { term: "memory leak", aliases: ["memory leaks"], phrase: "a program slowly holding on to memory it no longer needs (memory leak)", plain: "A bug where memory that should be released stays in use, so usage grows over time." },
  { term: "interface", aliases: ["interfaces"], phrase: "a promise about what an object can do, without saying how (interface)", plain: "A description of the properties and functions something must have, so different implementations can be used interchangeably." },
  { term: "polymorphism", phrase: "different kinds of things responding to the same request in their own way (polymorphism)", plain: "Using one interface to work with values of different types, each behaving appropriately." },
  { term: "inheritance", phrase: "a class borrowing the abilities of another class (inheritance)", plain: "A way for one class to reuse and extend the properties and behaviour of another." },
  { term: "refactor", aliases: ["refactoring"], phrase: "reorganising code to be cleaner without changing what it does (refactor)", plain: "Restructuring code while keeping its observable behaviour the same." },
  { term: "linter", aliases: ["lint", "linting"], phrase: "a tool that reads your code looking for likely mistakes and style problems (linter)", plain: "A program that analyses source code without running it and reports suspicious patterns." },
  { term: "compiler", aliases: ["compile", "compiling"], phrase: "the tool that turns your code into something the computer can run (compiler)", plain: "A program that translates source code into machine code or another lower-level form, and reports errors it finds on the way." },
  { term: "bundler", aliases: ["bundle", "bundling"], phrase: "a tool that packs many source files into a few files ready to ship (bundler)", plain: "A build tool that combines your modules and their dependencies into optimised output files." },
  { term: "CI/CD", aliases: ["CI", "continuous integration"], phrase: "an automatic pipeline that tests and ships your code on every change (CI/CD)", plain: "Continuous Integration / Continuous Delivery: automation that builds, tests and optionally releases code whenever it changes." },
  { term: "webhook", aliases: ["webhooks"], phrase: "a message another service sends to your server when something happens (webhook)", plain: "An HTTP request that one service sends to a URL you provide as soon as an event occurs." },
  { term: "JWT", aliases: ["JSON Web Token"], phrase: "a signed digital pass that proves who you are (JWT)", plain: "JSON Web Token: a compact, signed token carrying claims such as a user id. Anyone can read it; only the signature proves it was not altered." },
  { term: "OAuth", phrase: "a standard way to let one app act on your behalf at another without sharing your password (OAuth)", plain: "An authorization framework in which you grant an app limited access to your account via tokens instead of your password." },
  { term: "CORS", phrase: "browser rules about which websites may call your server (CORS)", plain: "Cross-Origin Resource Sharing: headers that tell a browser whether a page from one site may read responses from another." },
  { term: "CSRF", phrase: "a trick where another site makes your browser send a request you did not intend (CSRF)", plain: "Cross-Site Request Forgery: an attack that abuses the fact that browsers automatically attach your login cookies to requests." },
  { term: "XSS", aliases: ["cross-site scripting"], phrase: "an attack where someone's text gets run as code in other visitors' browsers (XSS)", plain: "Cross-Site Scripting: injecting script into a page so it executes in another user's browser." },
  { term: "SQL injection", phrase: "an attack where typed text is run as database commands (SQL injection)", plain: "Inserting SQL through input that the program pastes directly into a query. Parameterised queries prevent it." },
  { term: "sanitize", aliases: ["sanitization", "sanitise", "escaping"], phrase: "cleaning or neutralising input so it cannot do harm (sanitizing)", plain: "Removing or neutralising dangerous characters from input before using it." },
  { term: "mock", aliases: ["mocks", "stub", "stubs"], phrase: "a stand-in that fakes a real part so a test can run in isolation (mock)", plain: "A fake version of a dependency used in tests to control its behaviour and observe how it is used." },
  { term: "unit test", aliases: ["unit tests"], phrase: "a small automatic check of one piece of code (unit test)", plain: "A test that exercises a single function or class in isolation and checks its result." },
  { term: "regression", aliases: ["regressions"], phrase: "something that used to work and broke after a change (regression)", plain: "A bug in functionality that worked before a recent change." },
  { term: "semver", aliases: ["semantic versioning"], phrase: "the MAJOR.MINOR.PATCH numbering that signals how risky an upgrade is (semver)", plain: "Semantic Versioning: a major bump may break compatibility, a minor adds features compatibly, a patch only fixes bugs." },
  { term: "lockfile", phrase: "a file that pins the exact versions installed so everyone gets the same ones (lockfile)", plain: "A generated file recording the exact version of every dependency, making installs reproducible." },
  { term: "environment variable", aliases: ["env var", "env vars", "environment variables"], phrase: "a setting passed to a program from outside its code (environment variable)", plain: "A named value in the program's surroundings, often used for configuration and secrets so they stay out of source code." },
  { term: "debounce", phrase: "waiting until things go quiet before acting (debounce)", plain: "Delaying an action until a burst of triggers has stopped for a short time, such as waiting for typing to pause." },
  { term: "throttle", phrase: "allowing an action at most once per time window (throttle)", plain: "Limiting how often an action can run, no matter how often it is triggered." },
  { term: "lazy loading", phrase: "fetching something only when it is first needed (lazy loading)", plain: "Deferring the loading of a resource until the moment it is actually used." },
  { term: "singleton", phrase: "a thing that is only ever created once and shared (singleton)", plain: "An object designed so that only one instance exists and everyone uses that same one." },
  { term: "immutable", aliases: ["immutability"], phrase: "never changed after it is created; you make a new copy instead (immutable)", plain: "A value that cannot be modified once made. Changes produce a new value." },
  { term: "pure function", aliases: ["pure functions"], phrase: "a function whose answer depends only on its inputs and which changes nothing else (pure function)", plain: "A function with no side effects that always returns the same output for the same input." },
  { term: "side effect", aliases: ["side effects"], phrase: "something a function does besides returning a value, like writing a file (side effect)", plain: "Any change a function makes outside itself: modifying a variable, writing to disk, sending a request." },
  { term: "boilerplate", phrase: "repetitive setup code that has to be there but is not the interesting part (boilerplate)", plain: "Standard code that must be written in many places with little variation." },
  { term: "AST", aliases: ["abstract syntax tree"], phrase: "the tree-shaped structure a tool builds from your code in order to understand it (AST)", plain: "Abstract Syntax Tree: a structured representation of source code used by compilers and tooling." },
  { term: "LSP", aliases: ["language server", "language server protocol"], phrase: "a helper program that understands your code and answers editor questions about it (language server)", plain: "Language Server Protocol: a standard way for tools to ask a language-aware server for errors, definitions, references and types." },
  { term: "ownership", aliases: ["borrow checker", "borrowing"], phrase: "Rust's rule that each value has exactly one owner at a time (ownership)", plain: "In Rust, every value has a single owner; others may borrow it under strict rules the compiler (the borrow checker) enforces, preventing many memory bugs." },
  { term: "goroutine", aliases: ["goroutines"], phrase: "a very lightweight task that Go runs alongside others (goroutine)", plain: "A function running concurrently in Go, managed by the Go runtime rather than the operating system." },
  { term: "pointer", aliases: ["pointers"], phrase: "a note saying where a value lives, rather than the value itself (pointer)", plain: "A variable holding the memory address of another value." },
  { term: "exception", aliases: ["exceptions"], phrase: "an error that interrupts normal flow and must be caught or it stops the program (exception)", plain: "A signal raised when something goes wrong, which unwinds the call stack until some code handles it." },
  { term: "optional chaining", phrase: "safely reaching into something that might be missing (optional chaining)", plain: "The `?.` syntax: stops and gives undefined instead of throwing if a value along the path is null or undefined." },
  { term: "destructuring", phrase: "unpacking pieces of an object or list into separate variables (destructuring)", plain: "Syntax for extracting several values from an object or array in one statement." },
  { term: "scope", phrase: "the part of the code where a name is visible (scope)", plain: "The region of a program in which a variable or function can be referenced." },
  { term: "hoisting", phrase: "JavaScript quietly moving declarations to the top of their scope (hoisting)", plain: "In JavaScript, declarations are processed before code runs, so some names can be used before the line that defines them." },
  { term: "type guard", aliases: ["type narrowing", "narrowing"], phrase: "a check that tells the type system what kind of value you now have (type guard)", plain: "A condition that lets TypeScript narrow a value to a more specific type within a branch." },
  { term: "union type", aliases: ["union"], phrase: "a type that says 'one of these several possibilities' (union type)", plain: "A type that can be any one of a listed set of types." },
  { term: "enum", aliases: ["enumeration"], phrase: "a fixed list of named choices (enum)", plain: "A type with a small, fixed set of named values." }
];
var ESCAPE = /[.*+?^${}()|[\]\\]/g;
var escapeRegex = (s) => s.replace(ESCAPE, "\\$&");
var MATCHERS = GLOSSARY.map((entry) => {
  const names = [entry.term, ...entry.aliases ?? []].map(escapeRegex).join("|");
  return { entry, pattern: new RegExp(`(?<![A-Za-z0-9_])(?:${names})(?![A-Za-z0-9_])`, "i") };
});

// src/ui/highlight.ts
var words = (list) => new Set(list.split(" "));
var KEYWORDS = {
  js: words("const let var function return if else for while do switch case break continue class extends new this super import export from default async await try catch finally throw typeof instanceof in of interface type enum implements public private protected readonly static abstract null undefined true false void as satisfies keyof declare namespace yield delete"),
  python: words("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield async await None True False global nonlocal assert del match case"),
  go: words("func package import return if else for range switch case default break continue type struct interface map chan go defer select var const nil true false fallthrough goto"),
  rust: words("fn let mut pub struct enum impl trait use mod return if else for while loop match break continue as in ref self Self super crate const static async await move where true false unsafe dyn type"),
  json: words("true false null"),
  plain: /* @__PURE__ */ new Set()
};

// src/ui/code.ts
var MIN_CONTENT = 8;
function section(options, profile) {
  const title = inline(options.title);
  const count = options.body.length;
  const headLines = (text) => wrapText(text, profile.width).map((l) => [span(l, { role: "heading", bold: true })]);
  if (profile.screenReader) {
    const state = options.expanded ? "expanded" : `collapsed, ${count} ${count === 1 ? "line" : "lines"} hidden`;
    return [...headLines(`${title} (${state})`), ...options.expanded ? options.body.map((l) => fitLine(l, profile.width, profile.symbols.ellipsis)) : []];
  }
  const marker = profile.unicode ? options.expanded ? "\u25BE" : "\u25B8" : options.expanded ? "v" : ">";
  const label = `${marker} ${title}${options.expanded ? "" : ` (${count} ${count === 1 ? "line" : "lines"})`}`;
  return [...headLines(label), ...options.expanded ? options.body.map((l) => fitLine([span("  "), ...l], profile.width, profile.symbols.ellipsis)) : []];
}
var CALLOUT_WORD = { success: "OK", warning: "Warning", error: "Error", info: "Note", inactive: "Inactive", pending: "Pending" };
function callout(options, profile) {
  const title = inline(options.title);
  const head = profile.screenReader ? `${CALLOUT_WORD[options.level]}: ${title}` : `${profile.symbols.status[options.level]} ${title}`;
  const wrapped = wrapText(head, profile.width).map((l) => [span(l, { role: options.level, bold: true })]);
  const body = options.body === void 0 || options.body.trim() === "" ? [] : wrapText(sanitize(options.body), Math.max(MIN_CONTENT, profile.width - 2)).map((l) => [span("  "), span(l)]);
  return [...wrapped, ...body];
}

// src/show/explain-views.ts
var diffLine = (sign, text, profile) => fitLine([span(`${sign} `, { role: sign === "+" ? "success" : "error", bold: true }), span(text, { role: sign === "+" ? "success" : "error" })], profile.width, profile.symbols.ellipsis);
function changeView(summary, profile, options) {
  const risk = (r) => `line ${r.line}, ${r.severity}: ${r.message}`;
  const out = [
    ...heading(summary.file, profile),
    ...summary.added === 0 && summary.removed === 0 && !summary.approximate ? textLines("No changes compared with the committed version.", profile.width) : [],
    ...textLines(`+${summary.added} lines added, -${summary.removed} lines removed, ${summary.unchanged} unchanged.${summary.approximate ? " This file was too large for an exact line diff, so only the counts are approximate and no hunks are shown." : ""}`, profile.width)
  ];
  if (summary.symbolsAdded.length > 0) out.push(blank(), ...textLines(`Added: ${summary.symbolsAdded.join(", ")}`, profile.width, { role: "success" }));
  if (summary.symbolsRemoved.length > 0) out.push(blank(), ...textLines(`Removed: ${summary.symbolsRemoved.join(", ")}. Other code may still use ${summary.symbolsRemoved.length === 1 ? "it" : "them"}; run /jpe:impact on the file to see.`, profile.width, { role: "warning" }));
  for (const r of summary.risksIntroduced) out.push(blank(), ...callout({ level: r.severity === "high" ? "error" : "warning", title: "A possible risk was introduced", body: risk(r) }, profile));
  for (const r of summary.risksResolved) out.push(blank(), ...callout({ level: "success", title: "A possible risk no longer matches", body: risk(r) }, profile));
  for (const hunk of summary.hunks) {
    out.push(blank(), [span(`@@ -${hunk.beforeStart} +${hunk.afterStart} @@`, { role: "muted" })]);
    const lines = [...hunk.removed.map((t) => diffLine("-", t, profile)), ...hunk.added.map((t) => diffLine("+", t, profile))];
    out.push(...lines.slice(0, options.maxHunkLines));
    if (lines.length > options.maxHunkLines) out.push([span(`${profile.symbols.ellipsis} ${lines.length - options.maxHunkLines} more changed lines in this hunk`, { role: "muted" })]);
  }
  return out;
}
var LARGE_CHANGE_LINES = 300;
function reviewNotes(files) {
  const notes = [];
  for (const f of files) {
    for (const r of f.summary.risksIntroduced) notes.push({ basis: "confirmed", text: `${f.summary.file}:${r.line} introduces a possible ${r.severity} risk (a pattern match, not proof): ${r.message}` });
  }
  for (const f of files) {
    if (f.summary.symbolsRemoved.length > 0) notes.push({ basis: "confirmed", text: `${f.summary.file} no longer defines ${f.summary.symbolsRemoved.join(", ")}. Whether anything else still uses ${f.summary.symbolsRemoved.length === 1 ? "it" : "them"} has not been checked: run /jpe:impact on the file.` });
  }
  const deleted = files.filter((f) => f.status === "deleted");
  if (deleted.length > 0) notes.push({ basis: "confirmed", text: `${deleted.length} ${deleted.length === 1 ? "file was" : "files were"} deleted: ${deleted.map((f) => f.summary.file).join(", ")}.` });
  const sourceChanged = files.some((f) => !f.isTest && f.status !== "deleted");
  if (sourceChanged && !files.some((f) => f.isTest)) notes.push({ basis: "heuristic", text: "Source files changed and no test files did. That is a pattern worth a look, not a finding: the existing tests may already cover it." });
  const total = files.reduce((n, f) => n + f.summary.added + f.summary.removed, 0);
  if (total > LARGE_CHANGE_LINES) notes.push({ basis: "heuristic", text: `${total} lines changed. Large changes are harder to review well; consider whether it can be split.` });
  return notes;
}
var riskCounts = (summary) => {
  const by = (s) => summary.risksIntroduced.filter((r) => r.severity === s).length;
  const parts = [`${by("high")} high`, `${by("medium")} medium`, `${by("low")} low`].filter((p) => !p.startsWith("0 "));
  return parts.length === 0 ? "none found" : parts.join(", ");
};
function decisionLines(decision, profile) {
  const note = decision.note === void 0 ? [] : textLines(`Note: ${decision.note}`, profile.width, { role: "muted" });
  if (decision.state === "none") return statusBadge("inactive", "No review decision recorded for these changes", profile);
  if (decision.state === "stale") return [...statusBadge("warning", `Stale: the last decision (${decision.decision ?? "recorded"}) was about different changes than these`, profile), ...note];
  return [...statusBadge(decision.decision === "rejected" ? "error" : "success", `${decision.decision === "rejected" ? "Rejected" : "Approved"}, and these changes are unchanged since`, profile), ...note];
}
function reviewView(files, profile, options) {
  const notes = reviewNotes(files);
  const introduced = files.reduce((n, f) => n + f.summary.risksIntroduced.length, 0);
  const out = [...heading("Code review of uncommitted changes", profile)];
  if (files.length === 0) {
    if (options.skipped.length === 0) return [...out, ...textLines("There are no uncommitted changes to review.", profile.width)];
    return [...out, ...textLines("There are uncommitted changes, but none of the changed files could be analysed.", profile.width), blank(), ...callout({ level: "info", title: `${options.skipped.length} ${options.skipped.length === 1 ? "file was" : "files were"} not analysed`, body: options.skipped.join("; ") }, profile)];
  }
  if (options.decision !== void 0) out.push(...decisionLines(options.decision, profile), blank());
  out.push(
    ...textLines(`${files.length} ${files.length === 1 ? "file" : "files"} changed. ${introduced === 0 ? "No possible risks were introduced by pattern matching (that does not prove the change is correct)." : `${introduced} possible ${introduced === 1 ? "risk" : "risks"} introduced (pattern matches, not proof).`}`, profile.width),
    blank(),
    ...table(
      {
        columns: [{ header: "File", min: 12 }, { header: "Kind", min: 8 }, { header: "Lines", min: 8 }, { header: "Risks introduced", min: 10 }],
        rows: files.map((f) => [f.summary.file, `${f.status}${f.isTest ? ", test" : ""}`, `+${f.summary.added} -${f.summary.removed}`, riskCounts(f.summary)])
      },
      profile
    )
  );
  if (options.skipped.length > 0) out.push(blank(), ...callout({ level: "info", title: `${options.skipped.length} ${options.skipped.length === 1 ? "file was" : "files were"} not analysed`, body: options.skipped.join("; ") }, profile));
  if (notes.length > 0) {
    out.push(blank(), ...heading("Review notes", profile));
    for (const n of notes) out.push(...textLines(`[${n.basis}] ${n.text}`, profile.width, { role: n.basis === "confirmed" ? "warning" : "muted" }));
  }
  out.push(blank(), ...heading("Checklist for the reviewer", profile), ...bulletList(checklist(files), profile));
  if (options.showFileSections === false) return out;
  out.push(blank(), ...heading("Changes", profile));
  files.forEach((f, i) => {
    out.push(...section({ title: `${f.summary.file}  +${f.summary.added} -${f.summary.removed}`, body: changeView(f.summary, profile, { maxHunkLines: options.maxHunkLines }), expanded: options.expanded && i < 5 }, profile));
  });
  return out;
}
function checklist(files) {
  const items = [];
  const risky = files.flatMap((f) => f.summary.risksIntroduced.map((r) => `${f.summary.file}:${r.line}`));
  if (risky.length > 0) items.push(`Confirm each possible risk is intended: ${risky.slice(0, 8).join(", ")}${risky.length > 8 ? ", ..." : ""}.`);
  if (files.some((f) => f.summary.symbolsRemoved.length > 0)) items.push("Confirm nothing still uses the removed symbols (/jpe:impact).");
  items.push("Read each diff below; the tool can find patterns but cannot judge intent.");
  if (files.some((f) => !f.isTest && f.status !== "deleted")) items.push("Run the project's checks after approving (/jpe:verify).");
  return items;
}

// src/show/review-data.ts
var isRecord3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
var isCount = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
function isRisk(v) {
  return isRecord3(v) && typeof v["id"] === "string" && isCount(v["line"]) && ["high", "medium", "low"].includes(String(v["severity"])) && typeof v["message"] === "string";
}
function isHunk(v) {
  return isRecord3(v) && isCount(v["beforeStart"]) && isCount(v["afterStart"]) && isStrings(v["removed"]) && isStrings(v["added"]);
}
function isSummary(v) {
  return isRecord3(v) && typeof v["file"] === "string" && isCount(v["added"]) && isCount(v["removed"]) && isCount(v["unchanged"]) && Array.isArray(v["hunks"]) && v["hunks"].every(isHunk) && isStrings(v["symbolsAdded"]) && isStrings(v["symbolsRemoved"]) && Array.isArray(v["risksIntroduced"]) && v["risksIntroduced"].every(isRisk) && Array.isArray(v["risksResolved"]) && v["risksResolved"].every(isRisk) && typeof v["approximate"] === "boolean";
}
function isFile(v) {
  return isRecord3(v) && ["modified", "added", "deleted"].includes(String(v["status"])) && typeof v["isTest"] === "boolean" && isSummary(v["summary"]);
}
function isNote(v) {
  return isRecord3(v) && ["confirmed", "heuristic"].includes(String(v["basis"])) && typeof v["text"] === "string";
}
function isDecisionState(v) {
  if (!isRecord3(v) || !["none", "current", "stale"].includes(String(v["state"])) || !isCount(v["fileCount"])) return false;
  if (v["decision"] !== void 0 && !["approved", "rejected"].includes(String(v["decision"]))) return false;
  if (v["at"] !== void 0 && typeof v["at"] !== "string") return false;
  return v["note"] === void 0 || typeof v["note"] === "string";
}
function parseReviewData(raw) {
  if (!isRecord3(raw) || !Array.isArray(raw["files"]) || !raw["files"].every(isFile)) return void 0;
  if (!Array.isArray(raw["notes"]) || !raw["notes"].every(isNote)) return void 0;
  if (!isStrings(raw["checklist"]) || !isStrings(raw["skipped"])) return void 0;
  if (raw["decision"] !== void 0 && !isDecisionState(raw["decision"])) return void 0;
  return raw;
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
var viewState = atom({ plugin: "jpe", key: "view" }, "home");
var reviewState = atom({ plugin: "jpe", key: "review" }, null, { shape: "review-1" });
var reviewNoteState = atom({ plugin: "jpe", key: "reviewNote" }, "");
var reviewFileState = atom({ plugin: "jpe", key: "reviewFile" }, "");
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
async function runJpe($, args, timeoutMs) {
  return $.process.run(["node", `${$.plugin.root}/dist/cli.js`, ...args], { timeoutMs });
}
async function refreshHud($) {
  if (refreshing !== void 0) return refreshing;
  refreshing = (async () => {
    try {
      const result = await runJpe($, ["center", "hud", "--json"], HUD_TIMEOUT_MS);
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
var REVIEW_TIMEOUT_MS = 3e4;
var DECISION_TIMEOUT_MS = 2e4;
var MAX_NOTE = 500;
async function loadReview($) {
  try {
    const result = await runJpe($, ["show", "review", "--json"], REVIEW_TIMEOUT_MS);
    if (result.exitCode !== 0) throw new Error(result.stderr.replace(/^jpe:\s*/, "").trim() || `the command exited with code ${result.exitCode}`);
    const data = parseReviewData(JSON.parse(result.stdout));
    if (data === void 0) throw new Error("the review was in a format this version of JPE does not understand");
    await update($, reviewState, () => data);
  } catch (error) {
    await update($, reviewState, () => null);
    await say($, `Could not read the review: ${messageOf(error)}`);
  }
}
async function openReview($) {
  await update($, viewState, () => "review");
  await update($, reviewFileState, () => "");
  await say($, "");
  await loadReview($);
}
async function closeReview($) {
  await update($, viewState, () => "home");
  await say($, "");
}
async function decide($, decision) {
  const note = (await read($, reviewNoteState)).trim().slice(0, MAX_NOTE);
  try {
    const result = await runJpe($, ["review", decision, ...note === "" ? [] : ["--note", note]], DECISION_TIMEOUT_MS);
    if (result.exitCode !== 0) throw new Error(result.stderr.replace(/^jpe:\s*/, "").trim() || `the command exited with code ${result.exitCode}`);
    await update($, reviewNoteState, () => "");
    await say($, `Recorded: ${decision === "approve" ? "approved" : "rejected"}. This only records your decision; nothing was committed or changed, and it shows as stale if the files change.`);
    background(refreshHud($));
    await loadReview($);
  } catch (error) {
    await say($, `Could not record the decision: ${messageOf(error)}`);
  }
}
async function openCenter($, columns) {
  await update($, viewState, () => "home");
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
    if (await read($, viewState) === "review") {
      const review = parseReviewData(await read($, reviewState));
      const note = await read($, reviewNoteState);
      const openFile = await read($, reviewFileState);
      const selected = review?.files.find((f) => f.summary.file === openFile);
      const canDecide = review !== void 0 && review.files.length > 0;
      const top2 = review === void 0 ? [...rows(heading("Review of uncommitted changes", profile)), ...rows(textLines(notice === "" ? "Reading the review\u2026" : notice, columns - 2, { role: notice === "" ? "muted" : "warning" }))] : rows(reviewView(review.files, profile, { expanded: false, maxHunkLines: 30, skipped: review.skipped, showFileSections: false, ...review.decision === void 0 ? {} : { decision: review.decision } }));
      return /* @__PURE__ */ h(Box, { flexDirection: "column", backgroundColor: profile.theme.background }, top2, review === void 0 ? null : review.files.slice(0, 9).map((f, i) => /* @__PURE__ */ h(Button, { key: `file-${i + 1}`, hotkey: String(i + 1), label: `${i + 1}. ${openFile === f.summary.file ? "Hide" : "Show"} diff: ${f.summary.file}`, onPress: () => background(update($, reviewFileState, (current) => current === f.summary.file ? "" : f.summary.file)) })), selected === void 0 ? null : rows(changeView(selected.summary, profile, { maxHunkLines: 40 })), canDecide ? /* @__PURE__ */ h(Input, { key: "review-note", label: "Note (optional)", placeholder: "why you approve or reject", value: note, onInput: (v) => background(update($, reviewNoteState, () => v)), onSubmit: () => void 0 }) : null, canDecide ? /* @__PURE__ */ h(Button, { key: "approve", hotkey: "a", label: "a  Approve these changes (only records your decision)", onPress: () => background(decide($, "approve")) }) : null, canDecide ? /* @__PURE__ */ h(Button, { key: "reject", hotkey: "x", label: "x  Reject these changes (only records your decision)", onPress: () => background(decide($, "reject")) }) : null, /* @__PURE__ */ h(Button, { key: "refresh-review", hotkey: "r", label: "r  Read the review again", onPress: () => background(loadReview($)) }), /* @__PURE__ */ h(Button, { key: "back", hotkey: "b", label: "b  Back to the command center", onPress: () => background(closeReview($)) }), notice !== "" && review !== void 0 ? rows(textLines(notice, columns - 2, { role: "muted" })) : null, rows(textLines("Number keys open a file's diff. A decision is about exactly these changes and shows as stale if a file changes.", columns - 2, { role: "muted" })));
    }
    const now = new Date(Date.now());
    const actions = data === void 0 ? [] : homeActions(data, memory);
    const entries = rankCommands(query, memory);
    const top = entries[0];
    const parsed = parseQuery(query);
    const confirm = pending === null ? [] : [
      /* @__PURE__ */ h(Box, { flexDirection: "column" }, rows(textLines(`/${findCommand(pending.commandId)?.slash ?? pending.commandId}${pending.args === "" ? "" : ` ${pending.args}`} can change files, settings or installed software in this project. Run it?`, columns - 2, { role: "warning", bold: true })), /* @__PURE__ */ h(Button, { key: "confirm-run", hotkey: "y", label: "y  Yes, run it", onPress: () => background(launch($, pending.commandId, pending.args, true)) }), /* @__PURE__ */ h(Button, { key: "confirm-cancel", hotkey: "n", label: "n  Cancel", onPress: () => background(update($, pendingState, () => null)) }))
    ];
    return /* @__PURE__ */ h(Box, { flexDirection: "column", backgroundColor: profile.theme.background }, rows(heading("JPE command center", profile)), data === void 0 ? rows(textLines(notice === "" ? "Reading this project's facts\u2026" : notice, columns - 2, { role: "muted" })) : rows(hudLines(data, profile, now)), rows(heading("What to do", profile)), actions.map((a) => /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Button, { key: `action-${a.n}`, hotkey: String(a.n), label: `${actionHead(a).map((s) => s.text).join("")}`, onPress: () => background(launch($, a.commandId, a.args)) }), rows(actionBody(a, profile)))), data?.review === void 0 || data.review.changedFiles === 0 ? null : /* @__PURE__ */ h(Button, { key: "open-review", hotkey: "v", label: `v  Open the review of ${data.review.changedFiles} uncommitted ${data.review.changedFiles === 1 ? "file" : "files"} here`, onPress: () => background(openReview($)) }), confirm, /* @__PURE__ */ h(Input, { key: "palette", label: "Command", placeholder: "search, an item number, or a command and what to give it", value: query, onInput: (v) => background(update($, queryState, () => v)), onSubmit: (v) => background(submitQuery($, v)) }), query.trim() !== "" && entries.length > 0 ? /* @__PURE__ */ h(
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

/**
 * The command center's home screen as a document, and the numbered list of things to do from it.
 *
 * The same functions feed the text fallback (printed when no pane can be shown, and by `jpe center`) and the pane,
 * so a number means the same thing everywhere: item 1 in the text is item 1 on the pane's number key.
 */

import { blank, bulletList, heading, table, textLines, verificationBadge } from "../ui/components.js";
import { type Line, plain, span } from "../ui/doc.js";
import type { RenderProfile } from "../ui/profile.js";
import { displayWidth, inline, pad } from "../ui/text.js";
import { CENTER_COMMANDS, type CenterCommand, findCommand } from "./commands.js";
import type { HudData, ReviewSummary } from "./hud-data.js";
import { type CenterMemory, recentIds } from "./memory.js";
import { rankCommands } from "./palette.js";
import { type Basis, type Level, suggest } from "./suggestions.js";

/** How many items get a number key. */
export const MAX_NUMBERED = 9;

export type ActionTag = "next" | "favorite" | "recent" | "command";

export interface HomeAction {
  /** 1-based; the number key that launches it. */
  n: number;
  commandId: string;
  args: string;
  /** The slash command as typed: `/jpe:verify`. */
  slash: string;
  title: string;
  /** Why it is listed: the evidence for a next step, the summary otherwise. */
  detail: string;
  tag: ActionTag;
  changesThings: boolean;
  /** Only on next steps. */
  basis?: Basis;
  level?: Level;
}

/** "just now", "3 minutes ago", "2 days ago". */
export function formatAge(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "at an unknown time";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  const unit = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return unit(Math.floor(seconds / 3600), "hour");
  return unit(Math.floor(seconds / 86_400), "day");
}

const actionFor = (n: number, command: CenterCommand, tag: ActionTag, detail: string, extra: Partial<Pick<HomeAction, "args" | "basis" | "level">> = {}): HomeAction => ({
  n,
  commandId: command.id,
  args: extra.args ?? "",
  slash: `/${command.slash}`,
  title: command.title,
  detail,
  tag,
  changesThings: command.changesThings,
  ...(extra.basis === undefined ? {} : { basis: extra.basis }),
  ...(extra.level === undefined ? {} : { level: extra.level }),
});

/**
 * The numbered list: next steps from the facts first, then favourites, then recent commands, then the rest.
 * Each command appears once (its first, most specific, place). At most nine, so every item has a number key.
 */
export function homeActions(hud: HudData, memory: CenterMemory): HomeAction[] {
  const actions: HomeAction[] = [];
  const has = (id: string): boolean => actions.some((a) => a.commandId === id);
  const add = (command: CenterCommand | undefined, tag: ActionTag, detail: string, extra: Partial<Pick<HomeAction, "args" | "basis" | "level">> = {}): void => {
    if (command === undefined || has(command.id) || actions.length >= MAX_NUMBERED) return;
    actions.push(actionFor(actions.length + 1, command, tag, detail, extra));
  };

  for (const s of suggest(hud)) add(findCommand(s.commandId), "next", `${s.title}. ${s.why}`, { basis: s.basis, level: s.level, ...(s.args === undefined ? {} : { args: s.args }) });
  for (const id of memory.favorites) add(findCommand(id), "favorite", findCommand(id)?.summary ?? "");
  for (const id of recentIds(memory, MAX_NUMBERED)) add(findCommand(id), "recent", findCommand(id)?.summary ?? "");
  for (const c of CENTER_COMMANDS) add(c, "command", c.summary);
  return actions;
}

const TAG_WORDS: Readonly<Record<ActionTag, string>> = { next: "next step", favorite: "favorite", recent: "recent", command: "" };

function gitText(hud: HudData): string {
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

/** Where the review of the uncommitted changes stands, in words. A stale decision is never described as current. */
function reviewText(review: ReviewSummary, now: Date): string {
  const when = review.at === undefined ? "" : formatAge(review.at, now);
  if (review.state === "none") return "no decision recorded for these changes";
  if (review.state === "stale") return `last decision (${review.decision ?? "recorded"} ${when}) is stale: files changed since`;
  return `${review.decision ?? "decided"} ${when}, and the changes are unchanged since`;
}

/** The HUD facts as lines. The verification status is never cut: it wraps instead (see verificationBadge). */
export function hudLines(hud: HudData, profile: RenderProfile, now: Date): Line[] {
  const label = (text: string): Line => [span(text, { role: "muted" })];
  const project = [inline(hud.project.name), hud.project.ecosystems.length === 0 ? "no recognised language" : hud.project.ecosystems.join(", ") + (hud.project.packageManager === undefined ? "" : ` (${hud.project.packageManager})`)].join(" · ");
  const v = hud.verification;
  const age = v.at === undefined ? "never run" : `last run ${formatAge(v.at, now)}`;
  const servers = hud.languageServersMissing.length === 0 ? "all found" : `missing: ${hud.languageServersMissing.join(", ")}`;
  const mode = `${hud.runtime.offline ? "offline (documentation from the cache only)" : "online"} · approvals: ${hud.runtime.approval}`;

  const rows: Array<[string, string]> = [
    ["Project", project],
    ["Git", gitText(hud)],
    ...(hud.review === undefined || hud.review.changedFiles === 0 ? [] : ([["Review", reviewText(hud.review, now)]] as Array<[string, string]>)),
    ["Language servers", servers],
    ["Mode", mode],
  ];
  const keyWidth = Math.max(...rows.map(([k]) => displayWidth(k)), displayWidth("Verification"));
  const wide = profile.width >= 50 && !profile.screenReader;
  const valueWidth = Math.max(8, profile.width - keyWidth - 2);
  const out: Line[] = rows.flatMap(([key, value]): Line[] => {
    if (!wide) return [label(key), ...textLines(value, profile.width - 2).map((l): Line => [span("  "), ...l])];
    // Wrapped values hang under the value column, so the keys stay in their own column.
    return textLines(value, valueWidth).map((l, n): Line => [span(n === 0 ? pad(key, keyWidth) : " ".repeat(keyWidth), { role: "muted" }), span("  "), ...l]);
  });
  out.push(label("Verification"));
  out.push(...verificationBadge(v.status, profile).map((l): Line => [span("  "), ...l]));
  out.push(...textLines(age, profile.width - 2, { role: "muted" }).map((l): Line => [span("  "), ...l]));
  for (const reason of v.reasons) out.push(...textLines(reason, profile.width - 2, { role: "muted" }).map((l): Line => [span("  "), ...l]));
  if (v.problem !== undefined) out.push(...textLines(v.problem, profile.width - 2, { role: "warning" }).map((l): Line => [span("  "), ...l]));
  return out;
}

/** The notes and reason beneath an action's heading: whether it asks first, what kind of item it is, and why it is listed. */
export function actionBody(a: HomeAction, profile: RenderProfile): Line[] {
  const indent = (lines: readonly Line[]): Line[] => lines.map((l): Line => [span("   "), ...l]);
  const notes = [a.changesThings ? "asks first" : "", TAG_WORDS[a.tag]].filter((n) => n !== "").join(" · ");
  const why = a.basis === undefined ? a.detail : `${a.detail} (${a.basis})`;
  const width = Math.max(8, profile.width - 3);
  return [...indent(notes === "" ? [] : textLines(notes, width, { role: "muted" })), ...indent(textLines(why, width, { role: "muted" }))];
}

/** The number and command of an action, on one line. */
export const actionHead = (a: HomeAction): Line => [span(`${a.n}. `, { role: "muted" }), span(a.slash, { role: "accent", bold: true })];

/**
 * The numbered list as lines: the number and command on one line, then a muted line saying whether it asks first and
 * what kind of item it is, then the reason. Notes sit on their own lines so a narrow terminal wraps them instead of
 * cutting them off ("asks first" must never be lost).
 */
export function actionLines(actions: readonly HomeAction[], profile: RenderProfile): Line[] {
  return actions.flatMap((a): Line[] => [actionHead(a), ...actionBody(a, profile)]);
}

/** One short line for the status bar: the verification status word first, then only what needs attention. */
export function statusLineText(hud: HudData): string {
  const parts = [`JPE: ${hud.verification.status}`];
  if (hud.git.state === "dirty") parts.push(`${hud.git.branch} +${hud.git.changedFiles} changed`);
  else if (hud.git.state === "clean") parts.push(hud.git.branch);
  if (hud.languageServersMissing.length > 0) parts.push(`${hud.languageServersMissing.length} language ${hud.languageServersMissing.length === 1 ? "server" : "servers"} missing`);
  if (hud.runtime.offline) parts.push("offline");
  return parts.join(" · ");
}

/** The whole home screen as a document, in the order a person reads it. */
export function buildHome(hud: HudData, memory: CenterMemory, profile: RenderProfile, now: Date): Line[] {
  const actions = homeActions(hud, memory);
  const unnumbered = CENTER_COMMANDS.filter((c) => !actions.some((a) => a.commandId === c.id));
  return [
    ...heading("JPE command center", profile),
    ...hudLines(hud, profile, now),
    blank(),
    ...heading("What to do", profile),
    ...actionLines(actions, profile),
    ...(unnumbered.length === 0 ? [] : [blank(), ...heading("Also available", profile), ...bulletList(unnumbered.map((c) => `/${c.slash}${c.argHint === undefined ? "" : ` ${c.argHint}`}: ${c.summary}`), profile)]),
    blank(),
    ...bulletList(["Type /jpe on its own to open this again, or /jpe <command> to run one directly."], profile),
  ];
}

/** Palette results as text: used for `jpe center palette <query>` and when no pane can be shown. */
export function buildPaletteText(query: string, memory: CenterMemory, profile: RenderProfile): Line[] {
  const entries = rankCommands(query, memory);
  if (entries.length === 0) return [...heading("Command palette", profile), plain(`No command matches "${inline(query)}".`)];
  const marker = profile.unicode ? "★" : "*";
  const rows = entries.map((e, i) => [String(i + 1), `/${e.command.slash}${e.isFavorite ? ` ${marker}` : ""}`, e.command.summary]);
  return [...heading(query.trim() === "" ? "Command palette" : `Command palette: ${inline(query)}`, profile), ...table({ columns: [{ header: "#", align: "right", min: 2 }, { header: "Command", min: 10 }, { header: "What it does", min: 12 }], rows }, profile)];
}

/**
 * Screens for the workspace: the task list, recent sessions, and the "where you left off" summary.
 *
 * Pure. They draw what was recorded and what the project facts say, and nothing else. In particular a session is only
 * ever described by what JPE saw in it (when it started, how many files were edited and backed up); JPE does not know
 * what the session was about, and does not pretend to.
 */

import { formatAge, hudLines } from "../center/home.js";
import type { HudData } from "../center/hud-data.js";
import type { SessionSummary } from "../hooks/state.js";
import { type Task, openTasks } from "../tasks/tasks.js";
import { blank, bulletList, heading, statusBadge, table, textLines } from "../ui/components.js";
import type { Line } from "../ui/doc.js";
import type { RenderProfile } from "../ui/profile.js";
import { inline } from "../ui/text.js";

export const SHOWN_SESSIONS = 10;
export const SHOWN_DONE = 5;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function tasksView(tasks: readonly Task[], now: Date, profile: RenderProfile, showDone = false): Line[] {
  const open = openTasks(tasks);
  const done = tasks.filter((t) => t.doneAt !== undefined);
  const out: Line[] = [...heading("Tasks", profile)];
  out.push(...statusBadge(open.length > 0 ? "info" : "inactive", open.length === 0 ? "No open tasks" : `${plural(open.length, "open task", "open tasks")}`, profile));
  if (open.length > 0) {
    out.push(blank(), ...table({ columns: [{ header: "#", align: "right", min: 2 }, { header: "Task", min: 12 }, { header: "Added", min: 8 }, { header: "Id", min: 4 }], rows: open.map((t, i) => [String(i + 1), inline(t.text), formatAge(t.createdAt, now), t.id.slice(0, 6)]) }, profile));
  } else {
    out.push(blank(), ...textLines("Add one with `jpe task add <what to do>`.", profile.width));
  }
  if (showDone && done.length > 0) {
    out.push(blank(), ...heading("Done", profile), ...table({ columns: [{ header: "Task", min: 12 }, { header: "Done", min: 8 }, { header: "Id", min: 4 }], rows: done.slice(-SHOWN_DONE).reverse().map((t) => [inline(t.text), formatAge(t.doneAt ?? t.createdAt, now), t.id.slice(0, 6)]) }, profile));
  } else if (done.length > 0) {
    out.push(blank(), ...textLines(`${plural(done.length, "finished task is", "finished tasks are")} hidden. Add --all to show them.`, profile.width, { role: "muted" }));
  }
  out.push(blank(), ...bulletList(["This is your list. JPE adds, finishes or removes a task only when you ask.", "Finish one with `jpe task done <number>` (the number in the # column) or remove it with `jpe task remove <number>`."], profile));
  return out;
}

export function sessionsView(sessions: readonly SessionSummary[], now: Date, profile: RenderProfile): Line[] {
  const out: Line[] = [...heading("Recent sessions", profile)];
  if (sessions.length === 0) {
    out.push(...textLines("No sessions are recorded for this project yet. JPE records a session when Claude Code starts one here.", profile.width));
    return out;
  }
  out.push(
    ...table(
      { columns: [{ header: "Started", min: 8 }, { header: "Files edited", align: "right", min: 5 }, { header: "Backed up", align: "right", min: 5 }, { header: "Id", min: 4 }], rows: sessions.slice(0, SHOWN_SESSIONS).map((s) => [formatAge(s.startedAt, now), String(s.filesEdited), String(s.backups), s.id.slice(0, 8)]) },
      profile,
    ),
  );
  if (sessions.length > SHOWN_SESSIONS) out.push(...textLines(`${sessions.length - SHOWN_SESSIONS} older sessions are not shown.`, profile.width, { role: "muted" }));
  out.push(blank(), ...bulletList(["Only what JPE saw is shown: when the session started and how many files Claude edited and JPE backed up. JPE does not know what a session was about.", "Session records are removed a week after their last update, so this is recent history only."], profile));
  return out;
}

/** Where things stand: the project facts, the most recent session, and the open tasks. */
export function resumeView(hud: HudData, sessions: readonly SessionSummary[], tasks: readonly Task[], now: Date, profile: RenderProfile): Line[] {
  const out: Line[] = [...heading("Where you left off", profile), ...hudLines({ ...hud, openTasks: 0 }, profile, now), blank(), ...heading("Last session", profile)];
  const last = sessions[0];
  out.push(...textLines(last === undefined ? "No earlier session is recorded for this project." : `Started ${formatAge(last.startedAt, now)}; Claude edited ${plural(last.filesEdited, "file", "files")} and JPE backed up ${last.backups}.`, profile.width));
  const open = openTasks(tasks);
  out.push(blank(), ...heading("Open tasks", profile));
  if (open.length === 0) out.push(...textLines("No open tasks.", profile.width));
  else out.push(...bulletList(open.slice(0, 10).map((t, i) => `${i + 1}. ${inline(t.text)}`), profile), ...(open.length > 10 ? textLines(`${open.length - 10} more. Run \`jpe task list\`.`, profile.width, { role: "muted" }) : []));
  return out;
}

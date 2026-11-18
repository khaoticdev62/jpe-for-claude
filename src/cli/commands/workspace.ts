import { collectHud } from "../../center/hud.js";
import { JpeError } from "../../core/errors.js";
import { listSessions } from "../../hooks/state.js";
import { loadTasks, saveTasks } from "../../tasks/store.js";
import { addTask, completeTask, openTasks, removeTask } from "../../tasks/tasks.js";
import { paint } from "../../ui/paint.js";
import { resumeView, sessionsView, tasksView } from "../../workspace/views.js";
import { statusBadge } from "../../ui/components.js";
import { flagBool, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { renderContext } from "./render-profile.js";

const USAGE = "Usage: jpe task <add <text> | list [--all] | done <number> | remove <number>> [--json]";

/**
 * `jpe task add <text> | list [--all] | done <ref> | remove <ref> [--json]`
 *
 * The person's own task list for this project. `done <ref>` and `remove <ref>` take the number shown in `list`, or the
 * start of a task's id.
 */
export async function taskCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const sub = args.positionals[0] ?? "list";
  const json = flagBool(args, "json");
  const { profile } = await renderContext(args, ctx);
  const tasks = await loadTasks(ctx);
  const now = ctx.now();

  if (sub === "list") {
    if (json) ctx.out(JSON.stringify(flagBool(args, "all") ? tasks : openTasks(tasks), null, 2));
    else ctx.out(paint(tasksView(tasks, now, profile, flagBool(args, "all")), profile));
    return 0;
  }

  if (sub === "add") {
    const added = addTask(tasks, { id: ctx.newId(), text: args.positionals.slice(1).join(" "), at: now });
    if (added === undefined) throw new JpeError("INVALID_INPUT", `Nothing to add: give the task some text, and note the list holds at most 200 tasks. ${USAGE}`);
    await saveTasks(ctx, added.tasks);
    ctx.out(json ? JSON.stringify(added.task, null, 2) : paint(statusBadge("success", `Added task ${openTasks(added.tasks).length}: ${added.task.text}`, profile), profile));
    return 0;
  }

  if (sub === "done" || sub === "remove") {
    const ref = args.positionals[1] ?? "";
    const result = sub === "done" ? completeTask(tasks, ref, now) : removeTask(tasks, ref);
    if (result === undefined) throw new JpeError("INVALID_INPUT", `No open task matches "${ref}". Run \`jpe task list\` and use the number in the # column. ${USAGE}`);
    await saveTasks(ctx, result.tasks);
    ctx.out(json ? JSON.stringify(result.task, null, 2) : paint(statusBadge("success", `${sub === "done" ? "Marked done" : "Removed"}: ${result.task.text}`, profile), profile));
    return 0;
  }

  throw new JpeError("INVALID_INPUT", USAGE);
}

/** `jpe sessions [--json]`: the sessions JPE still has a record of. Read-only. */
export async function sessionsCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const sessions = await listSessions(ctx);
  if (flagBool(args, "json")) {
    ctx.out(JSON.stringify(sessions, null, 2));
    return 0;
  }
  const { profile } = await renderContext(args, ctx);
  ctx.out(paint(sessionsView(sessions, ctx.now(), profile), profile));
  return 0;
}

/** `jpe resume [--json]`: the project facts, the most recent session and the open tasks in one screen. Read-only. */
export async function resumeCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const [hud, sessions, tasks] = await Promise.all([collectHud(ctx), listSessions(ctx), loadTasks(ctx)]);
  if (flagBool(args, "json")) {
    ctx.out(JSON.stringify({ hud, lastSession: sessions[0] ?? null, openTasks: openTasks(tasks) }, null, 2));
    return 0;
  }
  const { profile } = await renderContext(args, ctx);
  ctx.out(paint(resumeView(hud, sessions, tasks, ctx.now(), profile), profile));
  return 0;
}

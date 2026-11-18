import path from "node:path";
import type { CliContext } from "../cli/context.js";
import { parseTasks, serializeTasks, type Task } from "./tasks.js";

export const TASKS_FILE = "tasks.json";

const fileFor = (ctx: Pick<CliContext, "stateDir">): string => path.join(ctx.stateDir(), TASKS_FILE);

/** The project's tasks. A missing or damaged file reads as no tasks. */
export async function loadTasks(ctx: Pick<CliContext, "stateDir" | "readText">): Promise<Task[]> {
  const text = await ctx.readText(fileFor(ctx)).catch(() => undefined);
  return text === undefined ? [] : parseTasks(text);
}

export async function saveTasks(ctx: Pick<CliContext, "stateDir" | "writeText">, tasks: readonly Task[]): Promise<void> {
  await ctx.writeText(fileFor(ctx), serializeTasks(tasks));
}

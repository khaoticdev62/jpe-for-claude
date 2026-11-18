/**
 * The project's task list: things the person wants to remember to do. It is the person's list. JPE adds a task only
 * when asked, and never marks one done or removes one on its own.
 *
 * Pure logic with no file access, so it can be tested directly and used anywhere.
 */

export const MAX_TASKS = 200;
export const MAX_TASK_CHARS = 200;
const MIN_ID_PREFIX = 4;

export interface Task {
  id: string;
  text: string;
  createdAt: string;
  doneAt?: string;
}

/** What the person wrote, made safe to store and show: one line, no control characters, at most 200 characters. */
export function cleanTaskText(raw: string): string {
  return Array.from(raw)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
      return control ? " " : ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TASK_CHARS);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const validTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** One stored task back into a task, or undefined when it is not a valid one. */
function parseTask(raw: unknown): Task | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, text, createdAt, doneAt } = raw;
  if (typeof id !== "string" || !/^[A-Za-z0-9]{4,32}$/.test(id)) return undefined;
  if (typeof text !== "string" || cleanTaskText(text) === "") return undefined;
  if (!validTime(createdAt)) return undefined;
  if (doneAt !== undefined && !validTime(doneAt)) return undefined;
  return { id, text: cleanTaskText(text), createdAt, ...(doneAt === undefined ? {} : { doneAt }) };
}

/** The saved task list. Anything that is not a list reads as empty, and unreadable entries are dropped. Never throws. */
export function parseTasks(text: string): Task[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => parseTask(entry) ?? []).slice(-MAX_TASKS);
}

export const serializeTasks = (tasks: readonly Task[]): string => `${JSON.stringify(tasks, null, 2)}\n`;

export const openTasks = (tasks: readonly Task[]): Task[] => tasks.filter((t) => t.doneAt === undefined);

/**
 * Adds a task. When the list is full, the oldest finished task makes room; if every task is still open, it is refused
 * (undefined) rather than silently dropping something the person has not finished.
 */
export function addTask(tasks: readonly Task[], input: { id: string; text: string; at: Date }): { tasks: Task[]; task: Task } | undefined {
  const text = cleanTaskText(input.text);
  if (text === "") return undefined;
  const task: Task = { id: input.id, text, createdAt: input.at.toISOString() };
  let list = [...tasks];
  if (list.length >= MAX_TASKS) {
    const oldestDone = list.findIndex((t) => t.doneAt !== undefined);
    if (oldestDone === -1) return undefined;
    list = list.filter((_, i) => i !== oldestDone);
  }
  return { tasks: [...list, task], task };
}

/**
 * Finds the task a person means: a number is the position in the open list as `jpe task list` shows it (1 is the first),
 * otherwise the start of a task's id. Returns undefined if nothing matches or the id start matches more than one.
 */
export function findTask(tasks: readonly Task[], ref: string): Task | undefined {
  const open = openTasks(tasks);
  if (/^\d{1,4}$/.test(ref)) return open[Number(ref) - 1];
  if (ref.length < MIN_ID_PREFIX) return undefined;
  const hits = tasks.filter((t) => t.id.startsWith(ref));
  return hits.length === 1 ? hits[0] : undefined;
}

/** Marks an open task done. Undefined if it is not found or is already done. */
export function completeTask(tasks: readonly Task[], ref: string, at: Date): { tasks: Task[]; task: Task } | undefined {
  const target = findTask(tasks, ref);
  if (target === undefined || target.doneAt !== undefined) return undefined;
  const done: Task = { ...target, doneAt: at.toISOString() };
  return { tasks: tasks.map((t) => (t.id === target.id ? done : t)), task: done };
}

/** Removes a task. Undefined if it is not found. */
export function removeTask(tasks: readonly Task[], ref: string): { tasks: Task[]; task: Task } | undefined {
  const target = findTask(tasks, ref);
  return target === undefined ? undefined : { tasks: tasks.filter((t) => t.id !== target.id), task: target };
}

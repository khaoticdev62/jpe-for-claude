# Workspace: resume, sessions and tasks

Three small, read-and-record features that help you pick a project back up. They use only what JPE has really recorded or can read from the project.

## `jpe resume` and `/jpe:resume`

One screen: the project facts (branch, uncommitted files, review state, latest verification, agents, language servers), the most recent session JPE recorded, and your open tasks. `--json` gives the same facts. `/jpe:resume` has Claude summarise it in plain English. It is also in the command center's palette.

## `jpe sessions`

The sessions JPE still has a record of, newest first: when each started, how many files Claude edited, and how many JPE backed up. That is all JPE saw. **JPE does not know what a session was about**, and neither the command nor the skill pretends to. Records are removed a week after their last update, so "no earlier session is recorded" is a normal answer. Damaged records are skipped, not shown as sessions that never happened.

## `jpe task`

Your task list for the project, kept in JPE's own data folder.

| Command | What it does |
|---|---|
| `jpe task add <text>` | Adds a task. The text is cleaned to one safe line of at most 200 characters. |
| `jpe task list [--all]` | Open tasks, numbered. `--all` also shows finished ones. |
| `jpe task done <number>` | Marks the task with that number done. |
| `jpe task remove <number>` | Removes it. |

The number is the one in the `#` column of `jpe task list`; the start of a task's id (at least four characters, if it matches only one task) also works. The list holds 200 tasks: when it is full, the oldest *finished* task makes room, and if every task is still open, adding is refused instead of dropping something you have not finished.

It is your list. JPE and Claude add, finish or remove a task only when you ask, and `/jpe:resume` is told never to mark a task done because it thinks the work is complete.

The command center's home screen shows a **Tasks** row ("3 open") when you have open tasks, and nothing when you do not.

## Not built

There are no task priorities, due dates or reminders, no link between tasks and sessions, and no summary of what an earlier conversation said (JPE does not record conversations).

---
description: Shows where the user left off in this project (project facts, the last session JPE recorded, uncommitted changes, open tasks) and manages their task list when asked. Use when they ask where they were, what is next, or to add, finish or remove a task.
argument-hint: "[task add <text> | task done <number> | task remove <number>]"
---

# /jpe:resume

Input: `$ARGUMENTS`

## Where you left off

If `$ARGUMENTS` is empty: run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" resume --width 100` (add `--json` for exact data). Then summarise in plain English:

- the state of the project (branch, uncommitted files, whether a review decision applies, the latest verification status word, exactly as printed),
- what JPE saw in the last session: when it started, and how many files Claude edited and JPE backed up,
- the open tasks.

## Be honest about what is known

- A session is described only by what JPE saw: its start time, and files edited and backed up. **JPE does not know what the session was about.** Do not guess, and do not claim to remember the earlier conversation.
- Session records are removed after a week. "No earlier session is recorded" is a normal answer.
- Do not say the work is finished, working or safe. Offer `/jpe:verify` for that, and `/jpe:review` for uncommitted changes.

## Tasks

The task list is the user's. Change it only when they ask:

- add: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" task add <their words>`
- finish: `... task done <number>` (the number shown by `task list`)
- remove: `... task remove <number>`
- show: `... task list` (add `--all` for finished ones)

Never add, finish or remove a task on your own initiative, and never mark one done because you think the work is complete. Repeat back exactly what the command reported.

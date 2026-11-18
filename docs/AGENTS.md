# Agent activity

JPE shows which agents Claude Code started and stopped in a project, and how long they took. It shows only what Claude Code actually reports, and says plainly what it does not know.

## What is recorded

Claude Code raises two events for subagents: **SubagentStart** and **SubagentStop**. JPE's hooks append one line to a small per-project file (`agents.jsonl`, in JPE's own data folder) for each. A line holds:

- the time JPE received the event,
- whether it was a start or a stop,
- the agent's id and type (for example `Explore`),
- the session id,
- on a stop, the *length* of the agent's last message.

It never stores the agent's task, its prompt, or its words. The file keeps the latest 1,000 events, and a damaged line is skipped, not fatal. Recording never changes, blocks or slows an agent: the hooks print nothing and fail open.

## What you can see

- `jpe agents` (or `/jpe agents`, or `/jpe:agents` for Claude to explain it): runs newest first, with state, start time, duration and a short id, then a table per agent type (runs, running, finished, typical and longest time). `--json` gives the same facts.
- The command center's home screen shows an **Agents** row once any event has been recorded: for example "1 running, 4 recorded".

## How states are decided

| State | Meaning |
|---|---|
| running | A start was seen, no stop was seen, and the start is less than 30 minutes old. |
| finished | A stop was seen. |
| no stop seen | A start was seen, no stop, and more than 30 minutes have passed. It may have been interrupted, or the event may not have arrived. JPE does not call it failed. |

Durations exist only for runs where both events were seen and are in order. "Typical" is the median of those. A stop whose start was trimmed away is still listed, with no duration.

## What JPE does not show

Claude Code does not report whether an agent *succeeded*, how far along it is, what it costs, or what it is working on, so JPE shows none of those and calculates no success rate. A "finished" run means a stop event arrived, not that the work was right. For that, use `/jpe:verify` and `/jpe:review`.

JPE does not start, stop, message or reconfigure agents. Everything here is read-only.

## Not built yet

The pane has no agents screen yet; the home screen row and the command line are the surfaces. The seven JPE agents themselves (researcher, explainer, and so on) are unchanged: this feature watches every subagent Claude Code reports, not only JPE's.

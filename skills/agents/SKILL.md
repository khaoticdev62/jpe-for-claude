---
description: Shows which agents Claude Code started and stopped in this project, how long finished runs took, and how often each agent type ran, then explains it in plain English. Use when asked what the agents are doing or have done. It reports only what Claude Code reported.
argument-hint: ""
---

# /jpe:agents

## Gather the facts

1. The screen: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" agents --width 100`. Add `--json` for the exact runs and per-type numbers.

## Explain, honestly

- **These are start and stop events and nothing else.** Claude Code reports that an agent started, that it stopped, its type, and the length of its last message. JPE records exactly that, and never the task or the agent's words.
- **Do not report success, failure, progress, cost or what an agent was working on.** None of that is reported. A "finished" run only means a stop event arrived; it says nothing about whether the work was right. If the user wants to know whether the work is correct, offer `/jpe:verify` and `/jpe:review`.
- **"No stop seen" is not "failed".** A run with a start and no stop for over 30 minutes may have been interrupted, or the event may not have arrived. Say that you do not know which.
- **Durations** exist only for runs where both events were seen. The "typical" time is the median of those.
- If nothing is recorded, say so. Do not infer activity from the conversation.

JPE does not start, stop, change or message agents. This skill only reads.

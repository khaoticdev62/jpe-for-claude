---
description: Shows the latest verification status for this project (VERIFIED, FUNCTIONAL_WITH_WARNINGS, PARTIALLY_VERIFIED, FAILED, BLOCKED or NOT_TESTED), what evidence supports it, and what is missing.
---

# /jpe:status

## Run

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" status
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" checks
```

## Report

- The status word and reasons exactly as printed, plus when the last verification ran. If the code has changed since then (compare the time with `git status`), say the status may be stale and suggest `/jpe:verify`.
- Which checks exist, which passed, which were not run and why.
- The git state (branch, uncommitted files) and any project instruction files found.
- One next step in plain English (for example "run /jpe:verify", or "tests are missing for this project").

Do not run the project's tests here; this command only reads recorded results. Do not change files.

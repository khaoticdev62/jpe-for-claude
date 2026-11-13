---
description: Investigates a failing test, build or error, finds the root cause, and repairs it in small checked steps with a backup and rollback. Use when something is broken and the user wants it fixed safely.
argument-hint: "[failure description or file]"
disable-model-invocation: true
---

# /jpe:fix

Problem: `$ARGUMENTS`

This command changes files. Follow every step; do not skip the backup or the re-verification.

## 1. Understand before touching anything

- Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" checks` and note the git state. If there are uncommitted changes, tell the user; they are protected by the backup in step 3 and you must never run `git reset --hard`, `git clean`, `git checkout -- .` or similar.
- Capture the baseline: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" verify --baseline`.
- Reproduce the failure: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" verify`. Read the failure output.
- For the root cause, delegate to the `jpe:jpe-debugger` agent (it investigates and proposes; it does not edit). Distinguish pre-existing failures (leave them alone and report them) from failures caused by recent changes.

## 2. Explain the plan in plain English

Before editing, tell the user: what is wrong (root cause, in everyday words), which files will change, the risk, and how it will be tested. For anything risky (deleting files, changing config, dependency changes, touching many files) wait for the user's go-ahead.

## 3. Back up, then make the smallest safe change

- `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" backup create <files you will edit> --label "fix: <short reason>"` (credentials files are refused; do not edit those).
- Edit only what the root cause requires. No unrelated cleanups.
- `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" backup seal <backup id>`.

## 4. Re-check, bounded

Run `verify` again, then the full set so regressions are caught. If it still fails, repair again, but obey the limit: at most the configured number of attempts (default 3, see `jpe config show` under engineering.maxRepairAttempts), and stop early if the same error comes back unchanged, no new idea exists, or time is running out. Never loop.

## 5. Finish honestly

- Success: report the final status word and evidence, what changed and why (use `jpe brief change <file>`), and the backup id.
- If you stop without success: say which blocker was reached, restore with `backup rollback <id>` if the edits made things worse (a conflict means someone else edited the file: show it to the user instead of forcing), and describe what is still broken.
- Never weaken, skip or delete a test to get a pass.

## Delegating to agents

Agents do not receive plugin variables automatically. Whenever you delegate to a `jpe:jpe-*` agent, put this line in its prompt, exactly as written: `JPE CLI: node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"`

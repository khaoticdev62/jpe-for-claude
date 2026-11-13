---
description: Runs the project's real type checks, tests, linting, builds and dependency audit, and reports an evidence-based status (VERIFIED, FUNCTIONAL_WITH_WARNINGS, PARTIALLY_VERIFIED, FAILED, BLOCKED or NOT_TESTED). Use after changes or when asked whether something actually works.
argument-hint: "[--only typecheck,unit-test,build] [--baseline]"
---

# /jpe:verify

Options: `$ARGUMENTS`

## Run

1. See what exists first: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" checks`. If it finds no verification commands, report NOT_TESTED. Do not invent tests or install a testing framework for the sake of it.
2. To separate old failures from new ones, a baseline must have been taken BEFORE the change: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" verify --baseline`. If you are verifying after edits and no baseline exists, say pre-existing failures cannot be told apart.
3. Run: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" verify` (add `--only ...` if the user asked for specific checks). It can take minutes; commands have a time limit from the configuration.
4. For language-server diagnostics on the changed files, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" lsp diagnostics <files>`. If the server is missing, the output says so: report that LSP did not verify the change.

## Report

- The status word from the output, verbatim, with its reasons. Never upgrade it. The status comes from recorded evidence only.
- A table of each check: command, passed/failed/not run.
- For failures: the key lines of the error, what they mean in plain English (`/jpe:explain error`), and whether the failure is new or pre-existing.
- What was NOT checked: skipped checks, missing tools, unavailable language servers, and whether tests were actually exercised for the changed code.

Never say "zero errors" or "all good". Say exactly what was run and what it showed. For delegated deep runs use the `jpe:jpe-verifier` agent.

## Delegating to agents

The `jpe:jpe-*` agents use the plugin's MCP tools (`jpe_*`) and need no extra setup. They cannot edit files or run shell commands. State the question and any file names clearly in the prompt.

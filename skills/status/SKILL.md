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

## Without a shell

If the Bash tool is unavailable or denied, use the plugin's MCP tools instead; they run the same code and print the same output:

| Command | MCP tool |
|---|---|
| `checks` | `jpe_overview` |
| `brief file`, `brief change`, `brief error` | `jpe_briefing` (kind, target) |
| `research <library>` | `jpe_research` |
| `verify` / `verify --baseline` | `jpe_run_verify` (baseline: true) |
| `status` | `jpe_verify_status` |
| `lsp status` / `lsp diagnostics <files>` | `jpe_lsp_status` / `jpe_lsp_diagnostics` |
| `impact <file>` | `jpe_impact` |
| `install-plan <language>` | `jpe_install_plan` |
| `scan` / `audit` | `jpe_scan` / `jpe_audit` |
| `doctor` | `jpe_doctor` |
| `config show` | `jpe_config_show` |

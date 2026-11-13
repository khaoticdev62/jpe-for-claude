---
description: Audits the project for security leads (hard-coded credentials, injection patterns, unsafe dependencies) and quality risks, with evidence and no false claims. Use before releases or when asked whether the code is safe.
argument-hint: "[area or path to focus on]"
---

# /jpe:audit

Focus: `$ARGUMENTS` (the whole project if empty)

## Gather evidence

1. Credentials: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" scan` (rule, file and line only; secret values are never printed. Do not print them yourself either; write `[REDACTED_SECRET_FOUND]`).
2. Risky patterns: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" audit`. Each result is a lead from pattern matching, not a confirmed vulnerability.
3. Dependencies: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" verify --only dependency-audit` and, for the most important dependencies, `jpe research <library>` which includes OSV advisories for the exact installed version.
4. For deeper investigation delegate to the `jpe:jpe-security` agent.

## Confirm before reporting

Open the code behind every lead and decide: confirmed issue, false positive, or needs a human decision. Report only what you checked.

## Report

- **Confirmed issues** (severity, file and line, how it could be abused in plain English, the smallest fix).
- **Leads that were false positives** (one line each, so the user trusts the process).
- **Not checked**: anything outside the scan's reach (running services, cloud configuration, secrets in git history, private registries). State it; do not imply the project is "secure".

Do not change files; offer `/jpe:fix` for repairs.

## Delegating to agents

The `jpe:jpe-*` agents use the plugin's MCP tools (`jpe_*`) and need no extra setup. They cannot edit files or run shell commands. State the question and any file names clearly in the prompt.

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

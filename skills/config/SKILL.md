---
description: Shows, changes, exports and imports JPE settings (explanation depth, documentation sources, repair limits, offline mode). Changes are validated and keep a backup of the previous file.
argument-hint: "[show | set <section.setting> <value> | export | import <file>]"
disable-model-invocation: true
---

# /jpe:config

Request: `$ARGUMENTS`

## Commands

- Show the effective settings: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" config show`
- Where the files live: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" config path`
- Change one setting for the user (global): `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" config set <section.setting> <value>`; for just this project add `--project`. Example: `config set explanation.depth deep`.
- Export (secret-looking fields are never exported): `config export --out jpe-config.json`
- Import: `config import <file>` (replaces that scope's file; the old file is kept as a timestamped `.bak-` copy).

## Rules

1. Explain each setting in plain English before changing it: what it does and what changes for the user. Settings and their allowed values are in the output of `config show` (invalid values are rejected with a reason; relay that reason).
2. Only change the setting the user asked about. Environment overrides: `JPE_OFFLINE=1` and `JPE_LOG_LEVEL` take priority over files.
3. Never put API keys or tokens in configuration. If the user offers one, refuse and explain that secrets belong in environment variables.
4. This only changes JPE's own settings. Do not edit Claude Code's `settings.json` or permissions.
5. After a change, run `config show` and tell the user what the effective value is now.

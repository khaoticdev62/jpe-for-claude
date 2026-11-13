# Plugin Spec Lock (Sprint 1 — Doc Recon)

Source: code.claude.com docs fetched 2026-11-13 by a subagent (all pages HTTP 200). Claude Code installed locally: 2.1.323.
Confidence: **V** = read verbatim, **S** = summary only (re-verify before relying on it), **T** = must be tested live.

## Manifest and layout
- `.claude-plugin/plugin.json`; only `name` is required (V). Everything else (`skills/`, `agents/`, `hooks/`, `.mcp.json`) sits at plugin root, NOT inside `.claude-plugin/` (V).
- Name `jpe`: kebab-case, not in reserved list (`claude-`, `anthropic-`, `cc-plugin-` prefixes etc.) (V).
- Unknown manifest keys are stripped with a warning, so keep to documented fields (V).
- Plugin-root `CLAUDE.md` is not loaded as context (V). Default `settings.json` honors only `agent` and `subagentStatusLine` (V).

## Skills (the 11 commands)
- `skills/<dir>/SKILL.md`; invoked as `/<plugin>:<dir>` e.g. `/jpe:explain` (V). Our `/jpe` entry skill therefore lives at `skills/jpe/` → `/jpe:jpe`; the bare `/jpe` is the alias skill (see below).
- Frontmatter we will use: `name`, `description`, `when_to_use`, `argument-hint`, `allowed-tools`, `disable-model-invocation`, `effort`. Unknown fields are silently ignored (V).
- Bare `/name` for a plugin skill: docs say it works unless another command uses the name (S). **T** — not claimed until tested in a live session.
- Commands in the product spec use the form `/jpe explain`; real invocation is `/jpe:explain` (or `/jpe explain` via the alias skill taking an argument). Documented honestly.

## Hooks
- File: `hooks/hooks.json`, top-level `"hooks"` key (V). Handler types: command, http, mcp_tool, prompt, agent (V).
- All events in the spec are real: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, ConfigChange, FileChanged (V). Extra useful: SessionEnd, SubagentStop.
- stdin fields we must validate: common (`session_id`, `cwd`, `hook_event_name`, `transcript_path`); PostToolUse (`tool_name`, `tool_input`, `tool_response`); FileChanged (`file_path`, `event`); ConfigChange (`source`, `file_path`) (V).
- Exit 0 = ok + JSON on stdout; exit 2 = block (only on events that can block; NOT PostToolUse/SessionStart); other = non-blocking error (V). Hooks must therefore **fail open** with exit 0 and never exit 2 except deliberate PreToolUse denials.
- Env: `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` (persists across updates — use for cache/backups), `CLAUDE_PROJECT_DIR` (V).
- Windows: exec form needs a real .exe; use `"command": "node"` with `args` (V).

## Agents (the 7 subagents)
- `agents/*.md`; required `name`, `description`; useful `tools`, `disallowedTools`, `model`, `maxTurns`, `effort`, `color` (V).
- Plugin agents IGNORE `hooks`, `mcpServers`, `permissionMode` (V) — so they cannot bypass the permission system by design. Tool restriction is via `tools`.
- Scoped name `jpe:jpe-researcher` etc. (V).

## MCP
- `.mcp.json` at root; `{"mcpServers":{"jpe":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/dist/mcp.js"]}}}` (V). Tools appear as `mcp__plugin_jpe_jpe__<tool>`.
- Context7 tool names seen live in this environment: `resolve-library-id`, `query-docs` (provider will discover advertised names at runtime, not hardcode).

## Marketplace
- `.claude-plugin/marketplace.json`: required `name`, `owner.name`, `plugins[]`; each entry `name` + `source` (relative `./` path without `..`, or github/git-subdir etc.) (V). Entry name must equal manifest name.

## Validate / install
- `claude plugin validate <path> [--strict] [--json]` (exit 0 pass, 1 fail, 2 validator error) (V).
- Dev load: `claude --plugin-dir <dir>` then `/reload-plugins` (V). Install: `claude plugin marketplace add <path>` then `claude plugin install jpe@<marketplace> --scope user|project` (V).

## Decisions locked
1. Plugin `name`: `jpe`. Skill dirs: `jpe, explain, research, verify, fix, impact, learn, status, audit, setup, config`.
2. Hooks run `node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/<event>.js` bundled single files; fail open.
3. State (cache, ledger, backups) in `${CLAUDE_PLUGIN_DATA}`; outside plugin context fall back to per-OS user data dir.
4. Validate with `claude plugin validate` in CI from Sprint 2 onward.

## Open items (carry forward)
- Re-verify env-var expansion in `.mcp.json` and rest of the MCP page (summary-only).
- Live-test bare `/jpe` alias and `--plugin-dir` load in Sprint 11/15.

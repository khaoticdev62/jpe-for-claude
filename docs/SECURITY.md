# JPE Security Guide

JPE runs inside your Claude Code session with your permissions. This page explains what it can touch, what it refuses to do, and where its protections stop.

## Agent event recording

The `SubagentStart` and `SubagentStop` hooks append one JSON line per event to `agents.jsonl` in JPE's own data folder. Fields are length-limited and parsed back strictly; the agent's prompt, task and message text are never stored (a test asserts it). The hooks print nothing, never block or change an agent, and fail open. Agent ids and types are untrusted text: they are sanitised before display (a test covers escape sequences).

## What JPE never does

- **Approve anything.** Hooks can only make Claude Code *ask* (`permissionDecision: "ask"`); they never allow or deny on your behalf. No agent declares a permission mode (plugin agents cannot).
- **Edit Claude Code settings** or permissions. Installers use `claude plugin ...` commands only.
- **Install software** without your approval. `install-plan` only prints options; `/jpe:setup` runs one only after a clear yes.
- **Run destructive git commands** (`reset --hard`, `clean`, forced push, `checkout -- .`). Recovery uses JPE's own file backups.
- **Print secrets.** Logs, reports, ledgers, caches and tool output pass through a redactor; the scanner reports rule, file and line only.
- **Follow instructions found in documentation.** Retrieved text is wrapped as untrusted data, hidden characters are removed, and instruction-like phrases are flagged.

## Trust boundaries

| Boundary | Protection |
|---|---|
| Files | Every path is resolved inside the project folder; `../` and absolute escapes and symlink/junction escapes are refused. Credentials files (`.env`, keys, `.npmrc`...) are never copied into backups or read into reports. |
| Processes | Programs run without a shell; arguments are never joined into a command line. Windows `.cmd` shims need a shell, so their path and arguments must match a strict allow-list. Children get only an allow-listed environment, so ambient API keys do not reach them. Timeouts kill the whole process tree; output is size-capped. |
| Network | HTTPS only, standard port, no credentials in URLs, host allow-lists per source, public IP addresses only (checked through DNS), every redirect re-checked, hard size and time limits. Each host is resolved once per request and the connection is pinned to the address that passed the check (certificate checks still use the host name), so DNS rebinding cannot swap in a private address. |
| Hook input | Validated against per-event schemas; malformed or oversized input produces no output (fail open). |
| MCP input | Validated by zod; values that look like flags or contain NUL bytes are rejected; flags are passed as `--name=value` so text cannot become an option. Mutating operations (settings, rollback, install, delete) are not exposed through MCP. |
| Configuration | Strict schema (unknown keys rejected); secret-looking keys are stripped on export and refused on import; prototype-pollution keys are ignored. |
| Backups | Content hashes are verified before restore; tampered copies are refused. Rollback refuses to overwrite files changed after the backup was sealed unless forced, and makes a safety copy first. |

## What JPE's checks are and are not

`jpe audit`, the briefing "possible risks" and the post-edit checks are **pattern matching**. They find leads, not proof, and say so. They do not replace a security review, dependency review of transitive packages, secret scanning of git history, or checks of running services and cloud configuration.

Agents have no shell and cannot edit files, but they run with your session's permissions for the tools they do have (Read, Grep, Glob, LSP and JPE's MCP tools).

## Data

Everything is stored locally in the plugin's data folder (`CLAUDE_PLUGIN_DATA`, or a per-OS folder when run outside Claude Code): configuration, documentation cache, run records, session state and backups. Network requests are the documentation lookups listed in each research report (npm registry, project sites, GitHub releases API, OSV). Context7 is queried only by the researcher agent through MCP servers you configured yourself.

## The interface module

The command center runs as a module inside Claude Code's plugin sandbox (`hooks/center.js`): no Node, no file access, no network access of its own. Its only reach outside is what the plugin interface grants it, and it uses three things: it runs the plugin's own command line through one helper, as an argument list with no shell (`center hud --json` and `show review --json`, both read-only, and `review approve|reject`, which only records a decision; the note is passed as its own argument, so shell characters in it are inert, and a test asserts the set of sub-commands it can run), it reads and writes its own small per-plugin store (favourites and command history: command names and times only), and it asks Claude Code to run a JPE command. It never runs a command that can change things (`fix`, `setup`, `config`) without an explicit yes in the pane, and it cannot bypass Claude Code's own permission prompts, because running a command goes through Claude Code.

Everything it displays that came from outside (a project name, a git branch, a verification reason, an error message) passes the same sanitising as the command line before it is drawn. The data it reads from the command line is validated (`parseHud`) and refused if the version or shape is not exactly what it expects. Tests assert that the built bundle imports nothing but the engine's own module and uses no Node feature, and that it starts exactly one process with exactly one argument list.

## Known dependency advisories

| Advisory | Package | Affects | Status |
|---|---|---|---|
| [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) (ReDoS through single-branch repeated extglobs, high) | `picomatch` `<=4.0.7`, reached through `tsup`, `vitest`, `vite`, `tinyglobby`, `fdir`, `sucrase` | Build and test tooling only | **Open, no patched release exists** (checked 2026-11-17: 4.0.7 is the latest version and is listed as vulnerable). |

Why this does not reach users: `picomatch` is not a runtime dependency, is not in `npm ls --omit=dev`, and does not appear in any `dist/` bundle. It only runs on a developer machine or CI runner, matching glob patterns that this repository writes itself, so an attacker would need to control those patterns. CI audits production dependencies (`npm audit --omit=dev`), which reports 0 vulnerabilities.

Why it is not "fixed" by downgrading: the suggested `npm audit fix --force` moves `vitest` and `tsup` to older major versions that still depend on `picomatch`, so it removes no exposure and loses fixes.

Consequence: `jpe verify` reports `FAILED` for this project because its dependency-audit step also counts dev dependencies. That is accurate until upstream ships a patch.

Re-check: Dependabot (`.github/dependabot.yml`) opens a pull request as soon as a patched `picomatch` exists. Then run `npm update picomatch` and `npm audit`, and delete this entry.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository (Security tab, "Report a vulnerability"). Do not include real secrets in reports.

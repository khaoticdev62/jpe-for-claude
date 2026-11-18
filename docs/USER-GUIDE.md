# JPE User Guide

JPE makes Claude Code explain its work in plain English and back its claims with evidence. This guide shows what to type and what to expect.

## The everyday loop

1. **Before a change:** `/jpe:verify --baseline` records how the project behaves now, so old failures are never blamed on new work. Ask Claude to plan; JPE's hooks remind it to explain what will change and why.
2. **During the change:** every file Claude edits is backed up first (`jpe backup list`). After each edit, JPE checks for credential-shaped text, broken JSON and language-server errors, and tells Claude.
3. **After the change:** `/jpe:verify` runs the project's own checks. The answer is one of six status words, followed by what was and was not checked.

## What the status words mean

| Status | Meaning |
|---|---|
| VERIFIED | Every check that applies ran and passed on its latest run. |
| FUNCTIONAL_WITH_WARNINGS | Checks passed, but with warnings: lint warnings, a failure that existed before the change, or no language server. |
| PARTIALLY_VERIFIED | Some checks passed; others never ran (the reason is listed). |
| FAILED | A check failed or timed out, or the language server reported errors. |
| BLOCKED | Something outside JPE stopped the work (for example a missing credential). |
| NOT_TESTED | Nothing applicable ran. JPE will not pretend otherwise and will not invent tests. |

## Commands

- `/jpe` on its own opens the command center: a pane with your project's facts, numbered next steps (press a number to run one) and a searchable command palette. Where no pane can be shown it prints the same screen as text. `/jpe verify`, `/jpe explain ...` and so on route straight to the sub-commands. Commands that can change things (`fix`, `setup`, `config`) always ask first. Details: [Command center](COMMAND-CENTER.md).
- `jpe show review` (in a terminal, or ask Claude to run it) shows every uncommitted change with risk notes and a reviewer's checklist; `jpe show file`, `change`, `impact`, `docs` and `diagnostics` show a file, a diff, what depends on a file, the official documentation for your installed version, and compiler findings as readable screens. Details: [jpe show](SHOW.md).
- `/jpe:resume` (or `jpe resume`) shows where you left off: the project's facts, the last session JPE recorded and your open tasks. `jpe task add <text>`, `list`, `done <number>` and `remove <number>` keep your own task list; JPE changes it only when you ask. Details: [Workspace](WORKSPACE.md).
- `/jpe:agents` (or `jpe agents`) shows the agents Claude Code started and stopped here and how long they took. It reports only what Claude Code reports; it cannot tell you whether an agent succeeded. Details: [Agent activity](AGENTS.md).
- `/jpe:review` reviews your uncommitted changes: Claude explains what changed and what the pattern checks found, and what you should confirm. `jpe review approve` or `reject` (or `v` in the command center) records *your* decision about exactly those changes; it records only, and shows as stale if any file changes afterwards. Details: [jpe show](SHOW.md).
- `/jpe:explain src/app.ts` explains a file: what it does, why, how, where it is used, what goes in and out, what depends on it, risks, concepts and an example. Simple code gets a short answer; hard code a step-by-step one.
- `/jpe:explain change src/app.ts` explains your uncommitted edits to a file.
- `/jpe:explain error "<message>"` explains an error message.
- `/jpe:research zod strictObject` checks the installed version's real signatures, release notes, deprecations and security advisories, listing every source.
- `/jpe:impact src/util.ts` lists what depends on a file before you change it.
- `/jpe:fix` investigates a failure, explains the cause, backs files up, repairs in at most three checked attempts (configurable), and re-verifies. It never weakens tests.
- `/jpe:learn closures` teaches a concept using code from your project.
- `/jpe:audit` looks for security and quality leads and separates confirmed issues from false positives.
- `/jpe:status` shows the latest result. `/jpe:setup` runs the health check and helps install language servers (only with your approval). `/jpe:config` shows or changes settings.

## Settings worth knowing

| Setting | Default | What it changes |
|---|---|---|
| `explanation.depth` | adaptive | `brief`, `standard`, `deep`, or automatic based on how complex the code is |
| `explanation.examples` | when-useful | `always`, `when-useful`, `never` |
| `engineering.maxRepairAttempts` | 3 | How many repair attempts `/jpe:fix` may make (0-10) |
| `engineering.approval` | risk-based | `risk-based` asks first for destructive or credential-related actions; `always` asks for everything; `off` leaves it to Claude Code's own rules |
| `lsp.continuousDiagnostics` | true | Language-server check after each edit (turn off if Claude Code's own LSP plugin already does this) |
| `hooks.requireVerificationBeforeStop` | true | One reminder per session to verify edited code before finishing |
| `runtime.offline` | false | Use only local information and cached documentation |
| `ui.theme` | jpe | `jpe`, `jpe-contrast` (high contrast), `jpe-colorblind`, `jpe-light` |
| `ui.color`, `ui.unicode`, `ui.density`, `ui.motion` | auto | Override what JPE detects about your terminal |
| `ui.screenReader` | false | Linear output with no borders or symbols, status spelled in words |
| `ui.navigation` | both | `standard` (arrows), `vim`, or `both` |

Run `jpe ui` to see what JPE detected about your terminal, why, and a live sample of every theme element; `jpe ui keys` lists the keyboard shortcuts. Details: [Design system](DESIGN-SYSTEM.md).

Change one with `jpe config set <setting> <value>` (add `--project` for this project only). `jpe settings` lists every setting with what it means and where its value comes from, `jpe settings unset <setting>` puts one back to its default, and `jpe settings preset` offers accessibility presets such as screen-reader and high-contrast (previewed first, applied only with `--apply`). Details: [Settings](SETTINGS.md).

## Undoing changes

`jpe backup list` shows backups. `jpe backup rollback <id>` restores them. If someone (you or Claude) changed a file after the backup was sealed, rollback skips that file and tells you, unless you add `--force`; a safety copy of whatever it replaces is always made first, so a rollback can itself be undone.

## When something seems off

Run `/jpe:setup` (or `node <plugin>/dist/cli.js doctor`). If something seems to be silently not happening, `jpe log --level warn` shows hook failures and timeouts; `jpe offline` shows whether offline mode is on (see [Offline mode and the event log](OBSERVABILITY.md)). It really starts each part of JPE and tells you in plain English what works and what to do about what does not. It also checks that JPE's saved records (agent activity, review decisions, the last verification) can be read, and that the built code matches the plugin version.

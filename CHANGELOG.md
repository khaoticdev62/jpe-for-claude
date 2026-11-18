# Changelog

All notable changes to JPE For Claude are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.6.0] - 2026-11-18

### Added
- Doctor: a **Records** check reads JPE's own saved records for the project (agent activity, review decisions, the last verification) and reports how many entries cannot be read. A damaged line was already skipped when reading; now it is noticed. Absent records produce no finding.
- Doctor: a **build-version** check compares the version the built MCP server reports with the plugin manifest, and warns when `dist/` is out of date.

### Fixed
- The Doctor's skills line said "eleven sub-commands" regardless of the real count; it now counts them.
- 6 new tests (24 in the Doctor suite).

## [1.5.0] - 2026-11-18

### Added
- Agent activity (see docs/AGENTS.md). JPE now records the start and stop events Claude Code reports for subagents (two new hooks, SubagentStart and SubagentStop), and shows them: `jpe agents [--json]`, the `/jpe:agents` skill (13 skills), a palette entry, and an Agents row on the command center's home screen.
- It shows running, finished and "no stop seen" runs, measured durations (only where both events were seen) and per-type use. It never shows success, progress, cost or the task: Claude Code does not report them, so JPE does not guess.
- The record holds ids, types, times and the length of the final message; never the agent's task or words. Appends are used so parallel agents lose no event; the record is trimmed to 1,000 events at session start.
- 47 tests for the record, the run model, the screen at 20 to 200 columns, hostile agent types, the HUD row and the real hook path.

## [1.4.0] - 2026-11-18

### Added
- Review decisions: `jpe review approve|reject [--note text]`, `status` and `history`. A decision is tied to a fingerprint of the exact changed files and their contents, so it is shown as **stale** the moment any file changes (or none remain); it records only and never commits, stages or changes anything. Notes are cleaned to one safe line, records are capped, and a damaged file reads as empty.
- `/jpe:review` skill (12 skills): Claude explains the review in plain English from the verified facts, labels heuristics as heuristics, and never records a decision on its own or calls a change correct.
- The command center pane has a review screen (`v` on the home screen): decision, overview, notes, checklist, a diff per file, a note box, and approve and reject buttons. The HUD, next steps and home screen show the review state; a rejected review of the current changes notifies.
- `jpe show review` includes the decision state in its screen and its JSON.
- 34 engine tests of the module (15 new), and 91 new vitest tests (923 in total).

### Changed
- The module starts processes through one helper that runs only `center hud`, `show review` and `review approve|reject`; a test asserts that set.
- `show review` and the review commands share one change-listing and one decision store.

## [1.3.0] - 2026-11-17

### Added
- `jpe show file|change|review|impact|docs|diagnostics` (`src/show/`, `src/cli/commands/show.ts`, documented in `docs/SHOW.md`): rich, width-aware views of what the engines verified. A file's code with possible risks marked on their lines beside its structure and plain-English concepts; a change as a diff; a review of every uncommitted file with notes marked confirmed or heuristic and a reviewer's checklist; what depends on a file (exact or approximate, stated); official documentation with trust, version match and freshness shown, deprecations quoted exactly, advisories raised and sources cited; and compiler or language-server findings with general-guidance explanations. `--json` gives the underlying data.
- Syntax highlighting for JavaScript/TypeScript, Python, Go, Rust and JSON (`src/ui/highlight.ts`), with four syntax roles in every theme at measured contrast. It is lossless: highlighted text always equals the original.
- Display components for code and explanations (`src/ui/code.ts`): code blocks with line numbers and annotations, side-by-side panels that stack when narrow, collapsible sections, and callouts. Each carries a glyph and a word so status is never colour-only, has a screen-reader form, and never exceeds the terminal width.

### Fixed
- The static analyzer flagged every `regex.exec(...)` call as "possible dynamic code execution (high risk)". It now flags `eval`, `new Function`, a bare `exec(...)` and `child_process.exec(...`, and leaves regular-expression matching alone.
- A new file's change summary reported "-1 lines removed" (empty text counted as one empty line), and a file's final newline counted as an extra line. Line counts are now exact.

### Changed
- `jpe research`, `jpe lsp diagnostics` and `jpe impact` now share their logic with the matching `jpe show` view instead of each carrying a copy. Their output is unchanged.

## [1.2.0] - 2026-11-17

### Added
- Command center (`src/center/`, `src/mod/`, documented in `docs/COMMAND-CENTER.md`). `/jpe` on its own opens a pane with real project facts, numbered next steps (each marked as a confirmed finding or only a suggestion, with its evidence), a command palette with fuzzy search, favourites and recent commands, a status-bar summary, and a toast for confirmed warnings. Where no pane can be shown it prints the same screen as plain text. `/jpe <command>` and every other command are unchanged. Commands that can change things (`fix`, `setup`, `config`) ask for confirmation in the pane before running.
- `jpe center`, `jpe center palette <query>` and `jpe center hud --json`: the same screens and data on the command line, read-only.
- The interface module (`hooks/center.js`, built from `src/mod/center.tsx`) and its state contract (`types/index.d.ts`), registered under `modules` in `hooks/hooks.json` beside the existing command hooks. It fails open: if it cannot load or throws, Claude Code skips it and `/jpe` runs the text menu as before.
- Doctor reports a missing or unregistered interface module.
- `npm run test:mod` runs 19 tests of the built module under Claude Code's own runner (local, needs the `claude` command). CI now also fails if `hooks/center.js` differs from what `src/` builds to.
- Terminal design system (`src/ui/`, documented in `docs/DESIGN-SYSTEM.md`): the JPE palette as four themes (`jpe`, `jpe-contrast`, `jpe-colorblind`, `jpe-light`) with contrast measured in tests; terminal capability detection with a stated reason for every decision; text sanitising and display-width handling; width-aware components (heading, status badge, progress bar, panel, table, key list, key hints) with Unicode and ASCII sets and a screen-reader layout; and a keyboard model (standard, Vim-style or both, numbered selection, validated overrides).
- `jpe ui` and `jpe ui keys`: show what JPE detected about the terminal and a live sample of the design system.
- `ui` section in the configuration (theme, colour, Unicode, density, motion, screen reader, navigation, shortcuts). It is optional with defaults, so existing configuration files load unchanged.
- Dependabot configuration (weekly, npm and GitHub Actions).

### Security
- Documented the open `picomatch` ReDoS advisory (GHSA-fc5q-39xc-vjpf). It affects dev tooling only, is absent from every shipped bundle, and has no patched release yet; see `docs/SECURITY.md`.

## [1.1.0] - 2026-11-17

### Added
- Welcome notice the first time JPE starts in a project (a one-line `systemMessage`).
- SessionStart now tells apart `startup`, `clear`, `compact` and `resume`: `compact` gets a short reminder and keeps the session's edit history, instead of resetting it.
- The risk policy and the failure explainer now cover the PowerShell tool (hook matchers include `PowerShell`).
- `scripts/sync-version.mjs`, run by `npm version`, keeps `plugin.json` and `marketplace.json` in step with `package.json`. The MCP server reads its version from `package.json` at build time.
- CI step that fails when the committed `dist/` differs from what `src/` builds to.
- Lint step (Biome, `npm run lint`) in the local checks and the CI workflow. The CI dependency audit now covers production dependencies only (`--omit=dev`), because the remaining findings are in build tools.

### Changed
- The MCP server is declared inline in `.claude-plugin/plugin.json`; the root `.mcp.json` is gone. Opening the plugin's own folder as a project no longer starts a second, failing `jpe` server (`Cannot find module '${CLAUDE_PLUGIN_ROOT}/dist/mcp.js'`, shown as CONNECTION_CLOSED).
- Risk assessment tokenizes the command line (quote-aware, every word position, `bash -c` / `powershell -Command` / `cmd /c` wrappers) instead of relying on one regex per case. It now catches split flags (`rm -f -r`), PowerShell abbreviations and aliases (`Remove-Item -r`, `ri`), `del /s`, `git push` with `+refspec` or clustered flags, and encoded PowerShell commands, and no longer flags quoted text such as `grep -r 'rm -rf'`.
- `jpe-researcher` uses an explicit read-only tool allow-list (it previously used a deny-list that inherited every other MCP server's tools, including file writers). Every agent now has an allow-list.

### Fixed
- A doctor test meant to cover Windows-style paths had lost its backslash to a string escape; it now tests what it says.
- Three variables without a declared type, an unreturned `forEach` callback and a few comma/assignment-in-expression test idioms found by the linter.

## [1.0.1] - 2026-11-17

### Security
- Closed the DNS-rebinding gap in the network guard: the validated IP address is now the one the connection uses, instead of the host name being resolved a second time.

## [1.0.0] - 2026-11-13

First release.

### Added
- Plugin with eleven skills (`/jpe` and ten sub-commands), seven restricted agents, six hooks and a 14-tool MCP server.
- `jpe` command line: briefing, research, verify, status, lsp, impact, install-plan, config, backup, scan, audit, doctor.
- Evidence ledger and completion-status rules: a status word can only come from commands that actually ran.
- Version-aware documentation engine with local-package, registry, release-note and advisory sources, a hash-checked cache and offline fallback.
- Language-server engine for 14 languages with a real LSP client, diagnostics, impact analysis and install planning.
- Backups before edits, sealed after edits, with conflict-aware rollback.
- JPE Doctor health check with safe repairs and a shareable report.
- Installers and uninstallers for Windows (PowerShell) and Linux/macOS (sh) that verify checksums and use Claude Code's own plugin commands; optional `/jpe` alias skill.
- Reproducible release package (zip + SHA256SUMS).
- Six deliberately broken sample projects with end-to-end tests using real tools, and a `claude plugin eval` behavioral suite.

### Fixed during development (found by the test suites)
- A new failure could hide behind an older failure in the same test command; baselines now fingerprint failures.
- Stall detection in the repair loop was timing-sensitive.
- Documentation research did not follow re-exports in installed type declarations.
- Doctor reports exported on Windows could contain the user name.

### Known limits
- Linux and macOS have not been run on real machines yet; the CI workflow exists but is manual-only.
- Declaration and risk detection in explanation briefings is pattern matching, not a full parser.

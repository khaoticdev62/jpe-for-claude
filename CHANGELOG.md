# Changelog

All notable changes to JPE For Claude are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

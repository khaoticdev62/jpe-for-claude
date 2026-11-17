# Changelog

All notable changes to JPE For Claude are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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

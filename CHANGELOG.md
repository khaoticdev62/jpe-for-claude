# Changelog

All notable changes to JPE For Claude are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First functional build.

### Added
- Plugin with eleven skills (`/jpe` and ten sub-commands), seven restricted agents, six hooks and a 14-tool MCP server.
- `jpe` command line: briefing, research, verify, status, lsp, impact, install-plan, config, backup, scan, audit, doctor.
- Evidence ledger and completion-status rules: a status word can only come from commands that actually ran.
- Version-aware documentation engine with local-package, registry, release-note and advisory sources, a hash-checked cache and offline fallback.
- Language-server engine for 14 languages with a real LSP client, diagnostics, impact analysis and install planning.
- Backups before edits, sealed after edits, with conflict-aware rollback.
- JPE Doctor health check with safe repairs and a shareable report.

# JPE For Claude 1.0.0: Implementation Report

Status labels used below: **Tested** (run for real and passed), **Partially tested** (some paths or platforms only), **Implemented** (code and unit tests, not run end-to-end for real), **Not available**.

## What was built

| Area | What exists | Status |
|---|---|---|
| Plugin | Manifest, icon, marketplace entry; `claude plugin validate .` passes with nothing to report | Tested |
| Commands | 11 skills: `/jpe` + explain, research, verify, fix, impact, learn, status, audit, setup, config | Tested in Claude Code: `/jpe`, `/jpe:status`, `/jpe config show`, `/jpe:verify`, `/jpe:explain`. Others: Implemented |
| Bare `/jpe` | Entry skill named `jpe`; optional alias skill from the installer | Tested (plugin via `--plugin-dir`; alias "not installed" path). Alias forwarding to an installed plugin: Implemented |
| Agents | 7 agents with restricted tools (no Write/Edit/Bash) | `jpe-lsp` and `jpe-verifier` Tested live; others Implemented |
| Hooks | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop (fail open) | Tested live: all six fired; backup before edit, seal after, Stop reminder caused verification |
| MCP | 14 tools via the official SDK 1.32.2 | Tested live (tool names, calls); agents call them |
| Explanation engine | Briefings, adaptive depth, 71-term glossary, 27 error patterns, change summaries | Tested (unit, e2e, eval) |
| Documentation engine | Local package (follows re-exports), npm registry, project site, GitHub releases, OSV, Context7-compatible provider, hash-checked cache, offline mode, guarded HTTPS | Local package + offline: Tested e2e. Network providers: unit-tested with fake responses; reachability Tested by Doctor `--deep` |
| LSP engine | 14 languages, real LSP client, diagnostics, impact, install plans | TypeScript Tested with the real server; other servers: Implemented |
| Verification | Real check runner, evidence ledger, six status words, baselines with failure fingerprints, bounded repair loop | Tested e2e with real tsc, node test runner, git |
| Recovery | Backups, seal, conflict-aware rollback, safety copies | Tested e2e |
| Security | Path containment, shell-free runner, env allow-list, secret scanning/redaction, untrusted-content wrapper, risk-based asks | Tested (unit + e2e) |
| Doctor | Real MCP handshake, hook run, agents/skills/config/cache/backups/LSP checks, safe repairs, sanitized export | Tested on this machine, including `--deep` |
| Config | Strict schema, layering, migrations, import/export without secrets | Tested |
| Installers | PowerShell and sh install/uninstall/update, checksum verification, alias handling | PowerShell: Tested (isolated Claude config). sh: Tested under Git Bash on Windows only |
| Release package | Reproducible zip + SHA256SUMS | Tested (byte-identical across builds) |
| CI | Cross-platform workflow | Implemented, manual-only by request; never run |
| GitHub release | Repository, tag, release assets | Not done: the push was blocked by the session's permission classifier |

## Test results (latest run)

- `npm run typecheck`: passed (strict TypeScript).
- `npm test`: 291 passed across 17 files (unit, e2e with real tools, MCP over stdio, installer/package checks).
- `claude plugin validate .`: passed, nothing to report.
- `node dist/cli.js doctor`: healthy. `--deep` earlier: npm registry, OSV, GitHub reachable; TypeScript server handshake OK; Context7 connected.
- `claude plugin eval` (3 cases, 1 run each, $0.59): with JPE 1.0/1.0/1.0; without JPE 0.67/0.33/0.0.

## Defects found by the suites and fixed

A new failure hidden behind an old one in the same test command; flaky stall detection; MCP server crash caused by a dynamic import (found by Doctor); username leak in exported Doctor reports; extensionless npm shims and lowercase drive letters breaking the LSP client on Windows; unredacted test output; PowerShell 5.1 quoting; ES-module warning in installed bundles; research not following re-exports; recursion detection; NUL bytes introduced by a patch.

## Dependencies

Runtime (bundled into `dist/`): `zod` 4.6.7, `@modelcontextprotocol/sdk` 1.32.2. Dev: TypeScript 7.0.2, tsup 9, vitest 5, @types/node.

## Platform compatibility

Windows 11: Tested. Linux, macOS: not run on real machines; code paths for them are unit-tested (paths, PATH lookup, process-group kill) and the CI workflow is ready to run manually.

## Known limitations

- Briefing facts (declarations, imports, risks) come from pattern matching, not a parser.
- Deep documentation support is npm-centric; other ecosystems get advisories and Context7.
- Context7 is only reachable through the researcher agent's MCP access.
- Duplicate diagnostics if Claude Code's own LSP plugin is also installed (setting to turn JPE's off).

## Remaining work

Done after 1.0.0: repository published (public), tag v1.0.0 and release assets attached, `claude plugin validate .` passes, `jpe doctor` is clean.

1. Run the manual CI workflow for Linux and macOS evidence. A first dispatch was refused by GitHub (account billing lock), so no job started.
2. Live-test the remaining agents and the alias forwarding to an installed plugin.
3. `npm audit` reports 7 high findings, all in dev build tools (picomatch ReDoS via vitest, tsup, vite). `npm audit --omit=dev` reports 0, so nothing in the shipped bundle is affected. The suggested fixes are major-version downgrades; revisit when upstream releases a patched picomatch. *(Historical, as of 1.0. Resolved by 2026-11-18: `npm audit` reports 0 across all dependencies; see [SECURITY.md](SECURITY.md).)*

## Installation

See [INSTALL.md](INSTALL.md). Short form: unzip the release and run `installer/install.ps1` (Windows) or `sh installer/install.sh` (Linux/macOS); or `claude plugin marketplace add khaoticdev62/jpe-for-claude` then `claude plugin install jpe@jpe-marketplace` once the repository is published.

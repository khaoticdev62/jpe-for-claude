# JPE For Claude — Phase 1: Agile Discovery & Stack Selection

Status: AWAITING APPROVAL. No code has been written. Environment: Windows 11, Node v22.21.0, Git 2.53, Claude Code 2.1.323. Target dir (the project directory) is empty (greenfield).

## 1. Core Mechanical Problem (JPE)

Claude Code writes code fast, but you can't see *why* it chose something, whether the API it used is real for your installed version, or whether it was actually tested. JPE is a layer that wraps Claude Code and forces three things: (1) explain in plain English before and after changes, (2) check claims against real evidence (installed package versions, official docs, language-server diagnostics, real test runs), (3) report status honestly (VERIFIED vs NOT_TESTED) with proof.

The hard engineering parts: a Claude Code plugin is mostly *markdown + JSON that Claude reads* (skills, agents, hooks config), plus small programs Claude can *call* (hooks, an MCP server, a CLI). So the real code is a Node CLI/library ("JPE core") that hooks, skills and MCP all share.

## 2. The Moat

- Evidence ledger: every verification result is stored with command, exit code, timestamp, and source — status labels can't be faked because the state machine only accepts evidence objects.
- Version-aware doc cache (content-hashed, with provenance and "verified vs cached" flags) — competitors paste docs; JPE proves which version they came from.
- Honesty contract encoded in types (the six completion states), not in prompt wording alone.
- Cross-OS installer + Doctor + rollback — rare in the plugin ecosystem.

## 3. Tech Stack (and why)

| Choice | Why |
|---|---|
| TypeScript strict, Node >= 20 (you have 22) | Plugins/hooks/MCP SDK are Node-native; one language for core, hooks, MCP, installer |
| `zod` (only runtime dep for validation) | Runtime validation of hook payloads, config, MCP I/O |
| `@modelcontextprotocol/sdk` | Official MCP server SDK for the hybrid MCP (JPE exposes research/verify tools) |
| `tsup` bundler → single `dist/*.js` files | Hooks must start fast and need no `node_modules` at runtime; reproducible |
| `vitest` | Fast TS-native tests; no extra frameworks |
| Python adapters | Optional only (e.g. pip-audit wrapper); none in v1 unless a gap is proven — zero-bloat rule |
| Context7 | Consumed as an *external* MCP; JPE will read its real advertised tool names at runtime (`resolve-library-id`, `query-docs` seen in this session), never hardcode-guess |

Rejected: Rust/Go core (cross-compile + plugin distribution cost with no perf need), a database (JSON files + atomic writes are enough, local-first), heavy DI frameworks (plain constructor injection).

## 4. File-Tree Blueprint

```
JPE Claude/
├─ .claude-plugin/
│  ├─ plugin.json              # plugin manifest
│  └─ marketplace.json         # marketplace-ready metadata
├─ skills/                     # 11 skills (/jpe:*), each skills/<name>/SKILL.md
│  ├─ jpe/ explain/ research/ verify/ fix/ impact/ learn/ status/ audit/ setup/ config/
├─ agents/                     # 7 subagents, tool-restricted
│  ├─ jpe-researcher.md  jpe-explainer.md  jpe-lsp.md  jpe-verifier.md
│  └─ jpe-security.md  jpe-architect.md  jpe-debugger.md
├─ hooks/hooks.json            # SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, ...
├─ .mcp.json                   # registers JPE MCP server (+ optional Context7 ref)
├─ src/
│  ├─ core/        orchestrator, evidence ledger, status state machine, errors, logger, di
│  ├─ config/      schema, defaults, migrations, import/export, paths (per-OS)
│  ├─ engines/
│  │  ├─ explanation/   depth scoring, jargon glossary, report templates
│  │  ├─ docs/          providers/{context7,official,local-package,repo-release,custom}, ranking, cache
│  │  ├─ lsp/           language detect, server registry, diagnostics, install advisor
│  │  ├─ verification/  tool discovery, runner, repair loop, regression diff
│  │  ├─ security/      secret scan, redaction, dep audit, path/command guards
│  │  └─ project/       manifest/lockfile readers, git state, impact analysis
│  ├─ hooks/       one small entrypoint per event (payload-validated, fail-safe)
│  ├─ mcp/         MCP server
│  ├─ cli/         `jpe` CLI (doctor, backup, rollback, export/import, update-check)
│  └─ doctor/
├─ installer/      install.ps1, install.sh, uninstall.*, alias skill template
├─ tests/          unit/ integration/ contract/ security/ e2e/ fixtures/broken-*/
├─ docs/           architecture, security, user guide, dev guide, install, testing
├─ .github/workflows/  ci.yml, release.yml (checksums)
├─ package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  CHANGELOG.md  README.md
```

## 5. Key Decisions Needing Your Call (defaults recommended)

1. **Bare `/jpe`**: Plugin skills are namespaced (`/jpe:explain`). I will verify the naming rules against current docs and provide a separate user/project-level alias skill; I will NOT claim it works until tested in a live session.
2. **Plugin name**: use `jpe` so commands read `/jpe:verify`. (Recommended.)
3. **LSP**: prefer Claude Code's native code-intelligence plugins; JPE detects/advises and verifies server start. No custom LSP client in v1 beyond spawning/diagnostics via CLI tools (e.g. `tsc`, `pyright`) where native LSP is unavailable.
4. **macOS/Linux testing**: I can only run Windows locally. Mac/Linux will be covered by GitHub Actions matrix; I will report them as "CI-tested" only after runs actually pass. GitHub MCP failed to connect this session (auth header error), so pushing to GitHub needs the `gh` CLI or a fix.
5. **Scope**: The spec is very large. Per sprint rules I'll deliver one sprint item at a time, each with a demo checklist.

## 6. Agile Backlog (one sprint item at a time, approval between each)

1. **Doc recon**: fetch current plugin/skills/hooks/subagents/MCP docs; lock manifest fields, skill naming, hook event names.
2. **Foundation**: package.json, strict TS, tsup, vitest, lint, CI skeleton, plugin.json, error/logger/DI primitives.
3. **Config system**: zod schema, defaults, global/project/env merge, migrations, import/export (secrets stripped), per-OS paths.
4. **Evidence ledger + status state machine** (six completion states).
5. **Security engine**: path validation, redaction, secret scan, command-injection-safe process runner.
6. **Project intelligence**: manifest/lockfile readers, git state, tool discovery.
7. **Verification engine** + bounded repair loop + backups/rollback.
8. **Documentation engine**: providers, version matching, cache, offline fallback, untrusted-content handling.
9. **LSP engine**: detection, registry (14 languages), diagnostics, install advisor.
10. **Explanation engine** + jargon glossary + depth scoring.
11. **Skills (11) + Agents (7)** with restricted tools.
12. **Hooks** (only events confirmed in docs).
13. **MCP server**.
14. **Doctor**.
15. **Installers/uninstaller/alias/update-check** (PowerShell + sh).
16. **Broken sample projects + e2e + behavioral evals**.
17. **Release**: docs, CHANGELOG, checksums, marketplace metadata, GitHub push.

Each item ends with real command output as evidence; nothing is marked VERIFIED without it.

## Approval Needed

Reply "approved" (or edits to the decisions in section 5) and I'll start Sprint 1.

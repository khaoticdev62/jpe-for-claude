# JPE Developer Guide

## Layout

```
.claude-plugin/       plugin.json, marketplace.json, icon.png
skills/<name>/        11 skills (the commands). Plain markdown that tells Claude what to run.
agents/               7 subagents. Restricted tool lists; no Write/Edit/Bash.
hooks/hooks.json      6 hooks, all running dist/hook.js
.mcp.json             the jpe MCP server (dist/mcp.js)
src/
  core/               errors, redaction, logger, evidence ledger, status rules
  config/             schema (zod), defaults, layering, migrations, import/export, paths
  security/           path containment, safe process runner, secret scanner, untrusted-content wrapper, risk rules
  project/            manifest and lockfile reading, check discovery, git state
  verification/       check runner, baselines and failure fingerprints, bounded repair loop
  recovery/           backups and rollback
  docs/               documentation engine: providers, cache, guarded HTTPS, version matching
  lsp/                language registry, detection, LSP client, diagnostics, impact
  explain/            glossary, static analysis, error library, change summaries, briefings
  hooks/              hook payloads, session state, handlers, fail-open runner
  mcp/                MCP tool definitions and server
  doctor/             health checks and safe repairs
  cli/                the `jpe` command line (all features are reachable here)
tests/unit            fast tests, no network
tests/e2e             real tools against deliberately broken projects (tests/fixtures/broken)
evals/                behavioral cases for `claude plugin eval`
installer/            install/uninstall scripts and the alias skill
scripts/              package.mjs (release), make-icon.mjs
dist/                 built bundles (committed so marketplace installs work without a build)
```

## Design rules

- **One implementation per feature.** The CLI is the only entry point to the engines; MCP tools call CLI handlers in-process, and skills run the CLI. Nothing is duplicated.
- **Evidence over assertion.** A status word comes only from `deriveStatus(ledgerEntries, requiredChecks)`. Never add a code path that sets a status directly.
- **Dependency injection.** Engines take their world (filesystem, process runner, network, clock, ids) as parameters, so tests run without the real world and e2e tests run with it.
- **Fail safe.** Hooks never throw and always exit 0. Unknown input is rejected by zod schemas; unexpected errors surface as short plain-English messages without stack traces or secrets.
- **No dynamic `import()` in bundled code.** It makes the bundler initialise zod lazily and broke the MCP server once (JPE Doctor caught it).

## Commands

```
npm install
npm run lint          # Biome lint (config and rule reasons in biome.jsonc; formatting is not enforced)
npm run typecheck     # strict TypeScript (tsconfig excludes the deliberately broken fixtures)
npm test              # unit + e2e (e2e needs node and git; LSP cases skip without typescript-language-server)
npm run build         # tsup -> dist/cli.js, hook.js, mcp.js, package.json
npm run package       # build + release/jpe-<version>/ + reproducible zip + SHA256SUMS
claude plugin validate .
claude --plugin-dir . # try it
claude plugin eval . --scaffold --trust-plugin --runs 1 --threshold 0.75 --allow-tools "mcp__plugin_jpe_jpe__*" --allow-real-servers
```

`dist/` is committed. Rebuild and commit it with every source change that ships, or marketplace installs from GitHub will run stale code.

## Releasing

1. Bump the version in `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `src/mcp/server.ts` (a test fails if they disagree), and add a CHANGELOG section.
2. `npm run lint && npm run typecheck && npm test && npm run package`.
3. `claude plugin validate .` and `node dist/cli.js doctor`.
4. Commit (including `dist/`), tag `v<version>`, push, and attach `release/jpe-<version>.zip` and its `.sha256` to a GitHub release.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, tests, build, package, a production-dependency audit and validation on Windows, Linux and macOS. It is **manual-only** (`workflow_dispatch`) so it never spends Actions minutes on its own; start it from the Actions tab when you want a cross-platform run.

## Adding things

- **A language:** add an entry to `src/lsp/registry.ts` (extensions, server binary and args, install options with a confidence level, optional compiler fallback). The registry test checks coverage.
- **A documentation source:** implement `DocProvider` in `src/docs/providers/`, use `safeRequest` with an explicit host allow-list, and register it in `src/cli/commands/research.ts`.
- **A hook:** add the payload schema in `src/hooks/payload.ts`, a handler in `handlers.ts`, the dispatch entry in `run.ts`, and the registration in `hooks/hooks.json`. Check the event against Claude Code's hook documentation first.
- **An MCP tool:** add a `ToolSpec` in `src/mcp/tools.ts` mapping to a CLI command. Keep it read-only unless there is a strong reason; destructive operations stay CLI-only behind user approval.

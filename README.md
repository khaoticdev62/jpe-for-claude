# JPE For Claude: Just Plain English

JPE is a plugin for [Claude Code](https://code.claude.com) that makes Claude explain what it is doing in everyday English, check its work against real evidence, and say plainly when something was **not** verified.

It does not add a second AI. It adds tools, hooks and rules around Claude Code so that three things become routine:

1. **Understand.** Explanations with the real technical term kept in parentheses, deeper for hard code and shorter for simple code.
2. **Verify.** Documentation for the exact installed version, language-server diagnostics, and the project's own tests and builds.
3. **Be honest.** A status word (`VERIFIED`, `FUNCTIONAL_WITH_WARNINGS`, `PARTIALLY_VERIFIED`, `FAILED`, `BLOCKED`, `NOT_TESTED`) that can only come from commands that actually ran.

## Quick start

Requirements: Claude Code and Node.js 20 or newer.

```
# Windows (PowerShell)                       # Linux / macOS
.\installer\install.ps1                      sh installer/install.sh
```

The installer shows what it will run, verifies the package checksums, and asks before changing anything. Details, other install routes and uninstalling are in [INSTALL.md](docs/INSTALL.md). Then restart Claude Code and type `/jpe`.

Or install straight from GitHub with Claude Code's plugin commands:

```
claude plugin marketplace add khaoticdev62/jpe-for-claude
claude plugin install jpe@jpe-marketplace
```

## Commands

| Command | What it does |
|---|---|
| `/jpe` | Menu and project overview; routes `/jpe <sub-command>` |
| `/jpe:explain <file / change / error>` | Plain-English explanation from a briefing built out of the real code |
| `/jpe:research <library>` | Version-aware documentation research with sources, signatures, deprecations and advisories |
| `/jpe:verify` | Runs the project's real checks and reports an evidence-based status |
| `/jpe:fix` | Investigates a failure, backs files up, repairs in bounded steps, re-verifies |
| `/jpe:impact <file>` | What depends on a file or symbol before you change it |
| `/jpe:learn <concept>` | Teaches a concept using this project's own code |
| `/jpe:status` | The latest status and what supports it |
| `/jpe:audit` | Security and quality leads, separated into confirmed, false positive and unchecked |
| `/jpe:setup` | Health check (JPE Doctor) and guided, approved language-server installs |
| `/jpe:config` | Show, change, export and import JPE settings |

Plugin skills are namespaced, so the full names are `/jpe:explain` and so on. Bare `/jpe` works because the entry skill is named `jpe`.

## What is inside

- **11 skills, 7 agents** (`jpe-researcher`, `jpe-explainer`, `jpe-lsp`, `jpe-verifier`, `jpe-security`, `jpe-architect`, `jpe-debugger`). Agents cannot write or edit files and have no shell; they use JPE's MCP tools.
- **6 hooks.** Session summary, a one-time workflow reminder, "ask first" for destructive or credential-related actions, automatic backup before the first edit of a file, post-edit checks (credentials, invalid JSON, language-server errors), and a one-time verification reminder before a turn ends. Every hook fails open.
- **14 MCP tools** (read-mostly; nothing that changes settings, rolls back, installs or deletes).
- **`jpe` command line** with the same operations (`node dist/cli.js help`).
- **JPE Doctor** (`jpe doctor [--deep] [--repair]`) that really starts the MCP server, runs a hook and checks language servers, the cache and backups.

## How JPE keeps its promises

- **Status comes from evidence.** An append-only ledger records each command, exit code and output tail (secrets redacted). `deriveStatus` is the only way to produce a status word. An unavailable language server never counts as verification.
- **Pre-existing failures are not hidden or "fixed".** A baseline taken before a change separates old failures from new ones, and regressions are reported.
- **Documentation is data, not instructions.** Retrieved text is quarantined, hidden characters are stripped, and instruction-like phrases are flagged. Cached material is always labelled "cached, not re-verified".
- **Network access is narrow.** HTTPS only, allow-listed hosts, public IPs only, redirects re-checked, hard size and time limits.
- **Permissions stay Claude Code's.** Hooks can only make Claude Code *ask*; nothing is ever auto-approved, and settings are never edited.
- **Local first.** Data lives in the plugin's data folder. Nothing leaves your machine except the documentation requests you can see in the research output.

## Supported languages

Language-server support: TypeScript, JavaScript, Python, Go, Rust, C, C++, C#, Java, Kotlin, PHP, Ruby, Lua, Swift. The depth of analysis is uneven: documentation research and import-based impact analysis are deepest for npm packages and JS/TS/Python projects; other languages get language-server diagnostics, advisories and Context7 (when connected).

## Known limits

- Declaration, import and risk detection in explanation briefings is pattern matching, not a parser; briefings say so and Claude is told to read the code.
- Context7 is queried by the researcher agent through MCP, not by the command line.
- Bare `/jpe` and the plugin were exercised in real Claude Code on Windows. Linux and macOS have not been run on real machines; the cross-platform CI workflow is manual-only. See [INSTALL.md](docs/INSTALL.md) for what is verified.
- If Claude Code's own language-server plugin is also installed you may see diagnostics twice; turn JPE's off with `jpe config set lsp.continuousDiagnostics false`.

## Development

```
npm install
npm run lint && npm run typecheck && npm test && npm run build
claude --plugin-dir .          # try the plugin from a checkout
npm run package                # build the release folder, zip and checksums into release/
```

More: [User guide](docs/USER-GUIDE.md) · [Developer guide](docs/DEVELOPER-GUIDE.md) · [Security](docs/SECURITY.md) · [Changelog](CHANGELOG.md). Licensed under MIT.

# Installing JPE For Claude

## Requirements

- Claude Code (the `claude` command on your PATH)
- Node.js 20 or newer
- Optional: git (for change tracking), a language server for each language you use (`/jpe:setup` helps)

## Option 1: the installer (recommended)

Unzip the release (`jpe-<version>.zip`), then from its folder:

| Platform | Install | Uninstall |
|---|---|---|
| Windows (PowerShell) | `.\installer\install.ps1` | `.\installer\uninstall.ps1` |
| Linux / macOS | `sh installer/install.sh` | `sh installer/uninstall.sh` |

What the installer does, in order:

1. Checks that `claude` and Node.js 20+ exist.
2. Verifies every file against `SHA256SUMS`. If anything differs, it stops before changing anything.
3. Shows the exact `claude plugin ...` commands it will run and asks for confirmation (`-Yes` / `--yes` skips the question).
4. Adds the local marketplace and installs the plugin using Claude Code's own commands. It never edits `settings.json` by hand and never downloads anything.
5. Optionally installs the `/jpe` alias skill (see below).
6. Confirms with `claude plugin list` and runs JPE Doctor.

Options (PowerShell / shell): scope `-Scope user|project` / `--scope user|project` (default `user`; `project` needs `-ProjectDir` / `--project-dir` or the current folder), `-DryRun` / `--dry-run` (show everything, change nothing), `-Source` / `--source` (path to the `jpe-marketplace` folder).

## Option 2: by hand

```
claude plugin marketplace add ./jpe-marketplace
claude plugin install jpe@jpe-marketplace --scope user
```

## Option 3: try it without installing

```
claude --plugin-dir ./path/to/plugin-folder
```

From a source checkout run `npm install && npm run build` first. The plugin is active for that session only.

## Scopes

- `user`: available in every project.
- `project`: recorded in that project's Claude Code settings so teammates get it too.

JPE's own settings can be set per user (`jpe config set ...`) or per project (`jpe config set ... --project`, stored in `.jpe/config.json`).

## The `/jpe` alias (optional)

The plugin's entry skill is already named `jpe`, so `/jpe` works once the plugin is installed. The optional alias skill (`-Alias` / `--alias`) adds a clearer message when the plugin is *not* installed in the current project, and forwards to the plugin when it is. It is installed to `~/.claude/skills/jpe/` (user scope) or `<project>/.claude/skills/jpe/` (project scope).

The installer never overwrites a different skill named `jpe`: it reports it and stops. `-ForceAlias` / `--force-alias` replaces it only after a confirmation, keeping a `.bak-` copy. The uninstaller removes only an alias that carries JPE's marker.

## Updating

Unzip the new release and run the installer with `-Update` / `--update`. It shows the release notes, backs up your JPE configuration (`config.json.bak-<time>`), verifies checksums, updates through Claude Code, and runs Doctor. If Doctor reports a problem, restore the backup and reinstall the previous release folder with the installer. Updates are always manual.

## Uninstalling

The uninstaller removes the plugin and, by default, **keeps** JPE's saved data (backups, caches, run records). `-PurgeData` / `--purge-data` deletes that data as well. `-RemoveMarketplace` / `--remove-marketplace` also removes the marketplace entry. Your projects and your Claude Code settings are not touched, apart from the entries Claude Code manages itself.

## Offline use

JPE works without a network for explanations, local code inspection, installed-package documentation, installed language servers, local tests and builds, and configuration. Online lookups (registry, release notes, advisories, Context7) are skipped and cached copies are used where they exist, labelled as not re-verified. Set `JPE_OFFLINE=1` or `jpe config set runtime.offline true`.

## Checking the installation

```
node <plugin folder>/dist/cli.js doctor           # or /jpe:setup inside Claude Code
node <plugin folder>/dist/cli.js doctor --deep    # also tests online sources and language-server start-up
```

## What has been tested

| Item | Evidence |
|---|---|
| Plugin, hooks, MCP server and agents loading in Claude Code | Run for real on Windows 11 with Claude Code 2.1.323 |
| Windows installer / uninstaller (PowerShell) | Run for real against an isolated Claude configuration |
| Shell installer / uninstaller | Run for real under Git Bash on Windows; Linux and macOS runs are produced by the CI workflow once it executes there |
| Release package | Built twice with identical bytes (reproducible) |

Anything not listed has not been verified on that platform.

## Troubleshooting

- `the 'claude' command was not found`: install Claude Code or add it to PATH.
- `checksum verification FAILED`: re-download the release; do not install a package that fails its checksums.
- `/jpe` is unknown: run `claude plugin list` in the project; install in the right scope, then `/reload-plugins`.
- Hooks seem silent: run Doctor; set `JPE_DEBUG=1` before starting Claude Code to log hook activity under the plugin data folder (`hook-debug.log`).

# Install, update and uninstall

Claude Code installs, updates and removes plugins. JPE does not replace that; it tells you what is installed, notices an update, and shows and clears what it has stored.

## What version is running

`jpe about` shows the version, the plugin folder, the data folder, whether your settings and project settings files exist, and warns if the built code and the plugin manifest disagree on the version (a stale build). `--json` gives the same facts.

`jpe about --check` asks GitHub whether a newer version is published, by reading the public plugin manifest on the main branch. It is one plain request that sends nothing about you or your project, it is refused in offline mode (and says so), and a failure is reported as "could not tell", never as "up to date". It reports one of: up to date, update available, you are ahead (a development build), or unknown with the reason.

## Updating

Run `claude plugin update <plugin>@<marketplace>` (`jpe about` prints the exact line for your install) and restart Claude Code. The next time a session starts, JPE says once that it was updated from one version to another and points at the changelog. It says nothing on the first run, nothing when the version is the same, and nothing on `/clear`, compaction or resume. Updates from versions before 1.10.0 are not announced, because no version had been recorded yet.

If you installed with the scripts in `installer/`, those still work and are described in [Installing](INSTALL.md).

## What JPE stores

`jpe data` lists everything in JPE's data folder:

| What | Contains |
|---|---|
| Settings | Your settings file and its timestamped backups |
| Documentation cache | Documentation pages fetched for `jpe research`, so offline mode has something to read |
| Per project: records | Tasks, review decisions, agent activity, the event log, the verification record, session records |
| Per project: file backups | Copies of files Claude edited, kept so `jpe backup rollback` can restore them |
| Other | The record of the last version that ran |

Nothing is stored in your project except `.jpe/config.json`, which is yours; JPE never deletes it. Sizes are counted without following links; on a very large folder the counts are marked as lower bounds.

## Clearing it

`jpe data remove <scope>` shows exactly what would be deleted and what you would lose, and **deletes nothing** until you run it again with `--confirm`.

| Scope | Removes | Keeps |
|---|---|---|
| `cache` | The documentation cache | Everything else |
| `records` | This project's records | This project's file backups, and all settings |
| `backups` | This project's file backups (rollback is no longer possible; this cannot be undone) | Everything else |
| `all` | Your settings, the cache, and every project's records **and backups** (cannot be undone) | Your project folders and any `.jpe/config.json` |

Removal only deletes names JPE itself creates, only inside its data folder. `all` deletes a fixed list of JPE's names, not "whatever is in the folder", so a data folder shared with something else loses nothing it does not own. Links are removed as links and never followed. Each target is checked again immediately before it is deleted.

If Claude runs `jpe data remove ... --confirm` on its own, JPE's approval check stops and asks you first (like other destructive commands).

## Uninstalling

`claude plugin uninstall <plugin>@<marketplace>`. Claude Code removes the plugin's data folder as well unless you add `--keep-data`. To clear JPE's data without uninstalling, use `jpe data remove`. Your projects, your Claude Code settings, and any `.jpe/config.json` in your repositories are not touched.

## Not built

JPE does not install or update itself, and does not run `claude plugin` commands for you: those stay yours. There is no automatic update check in the background, and no way to restore data after `jpe data remove --confirm`.

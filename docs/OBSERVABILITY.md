# Offline mode and the event log

## Offline mode

`jpe offline` shows whether offline mode is on, who set it (the default, your settings, the project's settings, or the `JPE_OFFLINE` environment variable), which documentation sources it affects, and how many documentation entries are cached.

Turn it on with `jpe config set runtime.offline true` (add `--project` for one project), or set `JPE_OFFLINE=1` for one run; `--offline` on `jpe research` does it for one command.

When it is on:

- **No network request is made.** This is enforced twice: the documentation engine skips every network source, and the network handle it is given refuses every request and DNS lookup. So even a source that forgot to check could not reach out. A test counts network calls with offline on (zero) and off (more than zero), so the zero means something.
- **Still works:** explanations and code inspection, installed-package documentation (read from your project), installed language servers, local tests, builds and lint, review, tasks, sessions, settings, and any documentation already cached.
- **Does not work:** fresh documentation from the official, release-notes and advisory sources unless a cached copy exists; `jpe doctor --deep` network probes.

JPE's offline mode covers JPE's own requests. Claude Code and other tools you use have their own network behaviour, which JPE does not control.

## The event log

JPE keeps a short log for the project so a problem is not silent. Hooks are built to fail open (if one breaks, Claude Code carries on as if JPE were absent), which used to mean a broken hook left no trace. Now it does.

`jpe log` shows the newest entries first. `--level debug|info|warn|error` sets the lowest level shown (default `info`), `--limit n` how many (default 30), `--json` the same facts.

**What is recorded:** a hook that failed (with the reason), a hook that timed out, each session start, and at the `debug` level how long each hook took. **What is never recorded:** prompts, file contents, command output, stack traces. Secrets are removed from every line, control characters are replaced, and each line is cut to 300 characters. Only the latest 500 entries are kept.

`runtime.logLevel` (`debug`, `info`, `warn`, `error`, default `info`; or `JPE_LOG_LEVEL`) sets the lowest level written. Errors are always written. Entries below the level are not stored, so raising the level later does not bring them back.

`jpe log` still opens if your settings file is damaged, and says so. That is the commonest cause of a failing hook, and `jpe doctor` also checks the settings.

## In the Doctor

`jpe doctor` reads the log: it reports how many entries cannot be read, and warns when hooks failed in the last 24 hours, with the latest reason and how to see them all (`jpe log --level error`).

## Not built

There is no log shipping, no crash reporting and no metrics: nothing leaves your machine. The command center has no log screen yet; `jpe log` is the surface. Entries are not tied to a particular session or agent.

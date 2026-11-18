# Release readiness

What has been checked, what has not, and how to check it again. Written from results that were actually produced, not from intent. A claim here is either backed by a command you can re-run or is listed under "Not verified".

## Re-run it

```
npm ci
npm run lint
npm run typecheck
npm test                      # unit tests, including the width, accessibility and documentation sweeps
npm run build
claude plugin validate .      # the plugin manifest, hooks and interface module, as Claude Code reads them
npm run test:mod              # the command center module under Claude Code's own test runner (needs `claude`)
npm audit
node dist/cli.js doctor       # starts the MCP server and a hook for real
node dist/cli.js verify       # one status word, from the project's own checks
```

`jpe verify` gives one of `VERIFIED`, `FUNCTIONAL_WITH_WARNINGS`, `PARTIALLY_VERIFIED`, `FAILED`, `BLOCKED`, `NOT_TESTED`, and it comes only from commands that ran.

## Verified (1.10.0)

| Area | Evidence |
|---|---|
| Lint, types, build | Biome lint, `tsc --noEmit` and the build pass. |
| Unit tests | More than 1,300 tests, run repeatedly. They cover the risk checks, hooks, verification, the language-server client against a real server, documentation research and its network guards, every screen, and the documentation itself. |
| Plugin contract | `claude plugin validate .` passes: manifest, 8 hook events, interface module, state contract. |
| Command center module | 34 engine tests under `claude plugin test`: every surface (terminal, desktop, editor, mobile), the review screen, failures, hostile input. |
| In a real session | Bare `/jpe` in a real headless Claude Code session prints the real home screen with no model call. The real built hook was fed real events and recorded them. `jpe about --check` was run against GitHub and agreed with what was published. |
| Accessibility settings | A sweep draws every screen from the last six releases in four modes (Unicode, ASCII, screen reader, both) at two widths. ASCII screens contain only ASCII; screen-reader screens contain no box or symbol glyphs; nothing overflows. Removing a real fix made the sweep fail, so it can fail. |
| Security | Risk checks resist reordered flags, wrappers and encodings. Network use is confined to one guarded request path (https only, host allow-list, public addresses only, DNS pinned, size and time limited) and is refused in offline mode at the network handle itself. Saved text is sanitised on the way in and again on the way out. Deleting saved data needs `--confirm`, and the approval check asks before it. Secrets are redacted from logs and reports. |
| Dependencies | `npm audit` reports 0 vulnerabilities for all dependencies on 2026-11-18. |
| Documentation | Every command is mentioned in a guide, every guide is linked from the README, and every relative link resolves (tests). |

## Not verified

- **How the command center pane looks on a real screen.** Everything is checked through the engine's test runner and text output; nobody has looked at the pane in a live window, on any surface.
- **Pressing a pane button in a live session.** `$.command.run` was confirmed from a later event, not from a live button press.
- **Real subagent events.** The hooks were fed real payloads through the built entry point; a live Claude Code subagent has not been observed triggering them.
- **Linux and macOS.** Everything was run on Windows. The cross-platform workflow exists but is manual-only (`workflow_dispatch`): GitHub Actions was refusing jobs because of an account billing lock when last tried, and it has not been retried since.
- **The installed copy.** The plugin installed in the author's Claude Code is an older version (1.1.0). It was deliberately not updated to code that had not been seen on a real screen.
- **The Claude Code mods API** is early access and may change; the module depends on it and on the `claude-code` types the engine provides.

## Known limits

- The status-bar line always uses a middle dot between facts, even in ASCII mode (it is built without a display profile).
- Updates from versions before 1.10.0 are not announced at session start, because no version had been recorded yet.
- Agent activity shows what Claude Code reports (start, stop, type, final-message length). It cannot show success, progress or cost, and does not guess them.
- Offline mode covers JPE's own requests, not Claude Code's or any other tool's.
- A hook that times out is recorded, but the work it was doing is not retried.

## Release checklist

- [ ] `npm ci`, lint, typecheck, test, build all pass on a clean checkout
- [ ] `claude plugin validate .` passes; `npm run test:mod` passes
- [ ] `npm audit` reports nothing, or each finding is recorded in [SECURITY.md](SECURITY.md)
- [ ] `node dist/cli.js doctor` reports healthy; `node dist/cli.js verify` reports `VERIFIED`
- [ ] `dist/` is rebuilt and committed (the plugin installs without a build step)
- [ ] Version bumped in `package.json`, then `node scripts/sync-version.mjs`; `CHANGELOG.md` updated
- [ ] README and the guides updated; the documentation tests pass
- [ ] Pushed; `jpe about --check` reports "up to date" from a clean install
- [ ] If the interface module changed: looked at the pane in a real window on the terminal surface

# JPE Command Center

Type `/jpe` on its own. JPE opens a pane beside the conversation with the facts about your project, numbered next steps, and a command palette. If a pane cannot be shown, `/jpe` prints the same screen as plain text instead. `/jpe <command>` (for example `/jpe explain src/app.ts`) still goes straight to that command, exactly as before.

## What you see

```
JPE command center
Project           my-app · node (npm)
Git               branch main, 3 uncommitted files
Language servers  all found
Mode              online · approvals: risk-based
Verification
  ✘ FAILED
  last run 26 minutes ago
  unit-test failed with exit code 1.

What to do
1. /jpe:fix
   asks first · next step
   Fix the failing checks. The last verification FAILED: ... (confirmed)
2. /jpe:explain
   ...
```

- **Project facts** are read, never guessed: the project, git, the saved verification record, language servers on your path, and your settings. If a fact cannot be read, the screen says so.
- **What to do** is a numbered list of at most nine items: next steps the facts support first (each says what it is based on, and whether that is a *confirmed* finding or only a *suggestion*), then your favourites, then recent commands, then the rest. Press a number key to run that item.
- **Command** is the palette. Type to search (`ver` finds Verify), type an item number, or type a command with what to give it (`explain src/app.ts`, also `/jpe:explain src/app.ts`). Enter runs the best match, the numbered item, or the typed command. The matches appear beneath it.
- **Favourites:** while you have a query, `f` adds or removes the top match from your favourites.
- **Status bar:** one line such as `JPE: FAILED · main +3 changed`, refreshed after each turn (at most every five seconds). A toast appears for a *confirmed* warning or error, once per session. Suggestions never toast.

### Keys

The pane uses Claude Code's own keyboard handling: number keys pick an item, Tab and the arrow keys move between items, Enter chooses, `y` and `n` answer a confirmation, Esc returns to the prompt and closes the pane. JPE's Vim-style keys and custom shortcuts (see the design system) are not wired into the pane yet.

### Commands that can change things ask first

`/jpe:fix`, `/jpe:setup` and `/jpe:config` can change files, settings or installed software. The pane never runs them on a single press: it asks "Run it?" and waits for `y`. Cancelling runs nothing. These are the same commands that Claude cannot start on its own.

### Honest results

A "Ran /jpe:verify" line appears only after Claude Code accepted the command. If it could not run, the pane says "Could not run ..." with the reason. A failed read of the project facts is shown as a failure with its reason, not as an empty or default screen.

## The Agents row

Once Claude Code has reported any subagent start or stop in the project, the home screen shows one **Agents** row, for example "1 running, 4 recorded". It is built from those events only (see [Agent activity](AGENTS.md)); with none recorded the row is absent rather than showing a zero.

## The review screen

When the project is a git repository with uncommitted changes, the home screen shows a **Review** row (where the review stands, in words) and a `v` button. Pressing it opens the review inside the pane: the decision so far, an overview table with the risks each file introduced, review notes marked *confirmed* or *heuristic*, a checklist, and a button per file that opens (and closes) its diff. A note box, **Approve** (`a`), **Reject** (`x`), **Read again** (`r`) and **Back** (`b`) finish the screen. Approve and reject only *record* a decision (see [jpe show](SHOW.md)); a decision about files that later changed is shown as stale. `/jpe:review` asks Claude to explain the same review in words.

## When there is no pane

A pane is docked beside the conversation from about 110 columns when you ask for it. On a narrower window, in a headless run, or where no surface can show panes, `/jpe` prints the home screen as plain text (no colour codes, so it reads the same in a transcript). The same numbers apply.

## From the command line

```
jpe center                      the home screen as text
jpe center palette <query>      search the commands (numbered as the palette numbers them)
jpe center hud [--json]         the project facts the interface reads
jpe center --json               facts, suggestions and the numbered list as data
```

All accept the display flags of `jpe ui` (`--width`, `--theme`, `--color`, `--unicode`, `--screen-reader`). They are read-only: they run no project command and change nothing.

## What it remembers

Favourites and recent commands are stored in Claude Code's per-plugin store on your machine. They only order the palette. They are not sent anywhere, hold no project content (only command names and times), are capped (20 favourites, 50 history entries), and a damaged record is read as empty rather than causing an error.

## Verified, and not verified

Verified (by tests and runs that actually happened): the module loads in a real Claude Code session; bare `/jpe` is intercepted and prints the real home screen from the real project, with no model call; `/jpe <args>` and every other command pass through untouched; the pane draws, and its buttons, number keys' targets, palette input, confirmation and favourites work, on the terminal, desktop, VS Code and mobile element tables (34 tests under `claude plugin test`, including the review screen: opening it, file diffs, approve and reject with and without a note, a note with shell characters passed as one argument, failures reported as failures, unreadable or mis-shaped data refused, and a stale decision drawn as stale); failures and unreadable facts are reported honestly.

Not verified, because it needs a person looking at a real window: how the pane actually looks (layout, colours on the pane's own `#121212` surface), whether number keys press the buttons while the search box is untouched, how pressing an item behaves in a live pane (the engine's `$.command.run` was confirmed from a later event, not from a pane press), and the desktop, VS Code and mobile appearance. The pane also uses the default `jpe` theme for now rather than your `ui.theme` setting.

## For developers

```
src/center/    pure logic, no Claude Code and no Node: commands, fuzzy search, palette, suggestions, memory, home screen
src/mod/       the interface module: draws the pane and wires events (center.tsx), plus a small API description (claude-code.d.ts)
hooks/center.js  the built module, committed so installs work without a build; listed under "modules" in hooks/hooks.json
types/index.d.ts the state contract Claude Code requires beside a module
```

Build with `npm run build` (a second bundle for the module, free of Node). `npm test` covers the pure logic and guards the bundle; `npm run test:mod` runs the module under Claude Code's own test runner and needs the `claude` command (so it is a local check, not part of CI). CI fails if `hooks/center.js` is not what `src/` builds to.

The plugin interface this uses is early access and Claude Code says it may change between releases. The module is therefore kept thin: it only draws and wires, all decisions live in `src/center`, and if the module fails to load or throws, Claude Code skips it and `/jpe` runs the text menu as before (it fails open on purpose). Doctor reports a missing module. To check the module against Claude Code's full generated declarations rather than the small description in `src/mod/claude-code.d.ts`, load the plugin with `claude --plugin-dir .` and type-check against the files Claude Code writes to `.claude-plugin/types/`.

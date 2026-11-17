# JPE Design System

How JPE decides what to draw and how to draw it. Everything here lives in `src/ui/` and is exercised by `tests/unit/ui-*.test.ts`. Run `jpe ui` to see the live result in your own terminal.

## Status

Phase 1 of the terminal-interface work: the foundation (tokens, capability detection, text safety, components, keyboard model, settings). The full command center, panes and the Claude Code interface build on it in later phases. Today it is reachable as `jpe ui` and `jpe ui keys`; there is no `/jpe` sub-command for it yet.

## One document, two backends

Components return a neutral document: lines of spans, each span carrying a *role* (`success`, `warning`, `muted`, ...), never a colour. `paint.ts` turns that into ANSI text for the command line. The in-Claude-Code interface will turn the same spans into native elements. Because both start from one document, they cannot disagree about what a screen says.

## Tokens

The default theme `jpe` uses the locked palette: background `#121212`, surface `#292929`, text `#F0F0F0`, secondary text `#BDBDBD`, foreground/heading `#FAFAFA`, accent `#9B6DFF`. Semantic roles: success, warning, error, info, inactive, pending (plus text, muted, heading, accent, border).

| Theme | For | Notes |
|---|---|---|
| `jpe` | dark terminals | the JPE identity |
| `jpe-contrast` | low vision, bright rooms | black background, every role at least 7:1 (WCAG AAA) |
| `jpe-colorblind` | colour-vision differences | success blue, warning yellow, error reddish purple (Okabe-Ito hues); never a red/green pair |
| `jpe-light` | light terminals | dark text and darker status colours |

Choose one with `jpe config set ui.theme <name>` or try one with `jpe ui --theme <name>`.

### Measured contrast on each theme's background

These numbers are computed by the code (`jpe ui` prints them) and asserted in `ui-tokens.test.ts`. Ratio is WCAG contrast; 4.5 is AA for normal text, 7 is AAA, 3 is the minimum for large text and interface parts.

| Role | jpe | jpe-contrast | jpe-colorblind | jpe-light |
|---|---|---|---|---|
| text | 16.4 | 21.0 | 16.4 | 16.7 |
| muted | 10.0 | 16.8 | 10.0 | 8.5 |
| accent | 5.4 | 11.6 | 5.4 | 6.1 |
| success | 10.0 | 16.8 | 8.1 | 5.9 |
| warning | 10.5 | 15.3 | 14.2 | 5.7 |
| error | 6.8 | 9.3 | 7.8 | 6.3 |
| info | 8.7 | 12.8 | 15.0 | 6.3 |
| inactive | 5.4 | 11.4 | 5.4 | 5.1 |

**Known limit, stated plainly.** The locked accent `#9B6DFF` measures 5.4:1 on the background but only 4.17:1 on the raised surface `#292929`, below the 4.5:1 AA line for small text. So on a raised surface the accent is reserved for bold headings, borders and other large or non-text parts (3:1 applies), and `inactive` and `border` are held to 3:1 there on purpose. `jpe-contrast` and `jpe-light` have no such exception. The tests spell out which roles are relaxed.

### Colour is never the only signal

Every status carries a glyph with its own shape and a word: `✔ VERIFIED`, `▲ FUNCTIONAL_WITH_WARNINGS`, `✘ FAILED`, `○ NOT_TESTED` (ASCII: `+ ! x -`). The six completion status words are always printed exactly as defined, never paraphrased; on a terminal too narrow to hold one on a line, it is split across lines rather than cut.

## Terminal capability detection

`detectCapabilities` reads the environment and the output stream and records a plain-English reason for each decision (`jpe ui` shows them under "Why").

| Decision | Rule, in order |
|---|---|
| Colour | `NO_COLOR` (non-empty) off; `FORCE_COLOR` 0/1/2/3; not a terminal: off; `TERM=dumb`: off; `COLORTERM` truecolor/24bit; Windows Terminal; VS Code, iTerm, WezTerm, Hyper, Ghostty; `TERM` with 256color; Windows console: truecolor assumed; otherwise 16 |
| Bold/dim/underline | allowed on a real terminal (and with `NO_COLOR`, which forbids colour only); none at all when piped, so redirected output has no escape sequences |
| Unicode | `JPE_ASCII`; `TERM=linux`/`dumb`: ASCII; locale (`LC_ALL`, `LC_CTYPE`, `LANG`) decides; Windows Terminal or VS Code: Unicode, legacy Windows console: ASCII; otherwise Unicode |
| Width | the terminal, then `COLUMNS`, then 80; clamped to 20-500 |
| Motion | reduced over SSH, in CI, when piped, or when `JPE_REDUCED_MOTION` is set |
| Screen reader | cannot be detected: set `ui.screenReader` or `JPE_SCREEN_READER=1` |

Explicit `ui.*` settings and `jpe ui` flags always beat detection. Detection is heuristic: it cannot see the real terminal, so an unusual terminal may need `ui.color` or `ui.unicode` set by hand.

### On any background

In the command line JPE paints only accents and status colours and leaves ordinary text in your terminal's own colour (secondary text is dimmed). Output stays readable on dark and light backgrounds. A pane that JPE owns (a later phase) paints its own background and uses the theme's text colours. The terminal cannot apply a theme to your whole window, so `#121212` applies inside JPE's own panes only.

## Layout

Breakpoints: narrow below 60 columns, medium below 100, wide from 100. Components adapt instead of overflowing:

- tables squeeze columns (cells end in an ellipsis), then fall back to stacked `Header: value` blocks
- headings and badges wrap; panels truncate lines that cannot wrap
- density is `compact` below 80 columns or 24 rows, otherwise `comfortable`

Nothing is ever wider than the width. This is asserted at every width from 20 to 200 in every combination of Unicode, ASCII, screen-reader, compact and no-colour modes.

## Screen-reader mode

`ui.screenReader` (or `--screen-reader`) gives linear output: no borders, no bars or glyphs, status written as words (`Status: FAILED`, `Error: ...`), progress as `Checks: 46 percent`, tables as `Header: value` blocks.

## Keyboard model

`src/ui/keymap.ts` decides which action a key press means. Reading the keyboard and drawing the result come with the interface in the next phase.

- Styles: `ui.navigation` is `standard` (arrows), `vim` (`h j k l`, `g`, `G`, `Ctrl+u`, `Ctrl+d`) or `both` (default).
- Numbered selection: digits 1-9 jump to that item in any list, unless you bound the digit.
- Overrides: `ui.shortcuts` maps an action to up to four keys, for example `jpe config set ui.shortcuts '{"palette":["ctrl+k"]}'`, or the same object under `ui` in the config file. An override replaces that action's defaults.
- Safety: a key that is invalid, already used by another action, or reserved is refused and reported (`jpe ui keys` lists what was ignored). Two overrides on one key both lose it. An action left with no key keeps its defaults. `Ctrl+C` always quits and `Esc` always goes back, so you can always get out.

## Untrusted text

Everything JPE draws may come from repositories, documentation or tool output. `sanitize` removes escape sequences (colour, cursor movement, window-title changes, hyperlink wrappers, device-control strings, terminal reset), control characters, and bidirectional overrides before any text is measured or drawn, and the painter sanitises again, so no span can drive the terminal whatever built it. Tests feed hostile strings through every component.

## What is not covered yet

- Interactive input handling and panes (the keymap is ready; the reader and the panes are next).
- Terminal-width math is a compact built-in table, not the full Unicode database: common CJK, emoji, flags and combining marks are right, exotic scripts may be off by a column.
- Verified only on Windows in this environment. Linux and macOS run in CI; SSH sessions, real screen readers and unusual terminals need manual checking.

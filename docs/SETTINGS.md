# Settings, personalization and accessibility

`jpe settings` shows every JPE setting in plain English, and `jpe config set` changes one. Settings live in two JSON files: yours (applies everywhere) and the project's (`.jpe/config.json`, applies only there). The project's beats yours, and two environment variables (`JPE_OFFLINE`, `JPE_LOG_LEVEL`) beat both.

## See what is set

- `jpe settings` lists every setting by group: its current value and where that value comes from (default, your setting, this project, or the environment). `--json` gives the same facts.
- `jpe settings ui.motion` explains one: what it does, its current value and source, its default and every allowed value.

The list of settings, their allowed values and their defaults are read from JPE's own schema, so they cannot go out of date. Only the plain-English sentences are written by hand, and a test fails if a setting has none.

## Change or reset a setting

- `jpe config set ui.motion reduced` changes one (add `--project` for this project only). A value that is not allowed is refused with the reason, and the file you replace is kept as a timestamped `.bak-` copy.
- `jpe settings unset ui.motion` removes it from your file (or the project file with `--project`), so it goes back to the default, or to the next layer down. If it was not set there, nothing is written and you are told where it does come from.

## Accessibility and appearance presets

`jpe settings preset` lists them. `jpe settings preset <name>` shows exactly what would change and writes nothing; add `--apply` to make the change.

| Preset | What it sets |
|---|---|
| screen-reader | Screen-reader mode on (linear text, no borders or symbols, status in words), no colour, reduced motion |
| high-contrast | The high-contrast theme |
| colorblind | The colour-blind-safe theme |
| low-motion | Reduced motion |
| ascii | Plain ASCII instead of Unicode |
| plain | No colour, no Unicode, reduced motion (logs, old terminals, pipes) |
| default | Every appearance setting back to its default; your key bindings are kept |

Presets change only `ui.*` appearance settings, never security, approval or engineering settings. If your settings file is damaged, JPE tells you and leaves it untouched.

## Through Claude

`/jpe:config` has Claude do the same: explain each setting before changing it, preview a preset before applying it, and apply one only when you ask.

## Not built

There is no interactive settings pane or live theme preview in the command center yet, and no per-terminal profiles. `jpe ui` shows what JPE detected about your terminal and a sample of every theme element.

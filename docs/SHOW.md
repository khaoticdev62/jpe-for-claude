# `jpe show`: rich views of what JPE found

`jpe show` renders what JPE's engines can verify about your code as readable, width-aware screens. It is read-only (see the one exception below) and works anywhere `jpe` runs; the command center and the review skill build on it.

```
jpe show file <path>              a file's code, possible risks marked on their lines, beside its structure
jpe show change <path>            one file's uncommitted change as a diff
jpe show review                   every uncommitted change: overview, notes, checklist, diffs
jpe show impact <file>            what depends on a file
jpe show docs <library>           official documentation for the installed version
jpe show diagnostics <files...>   compiler or language-server findings
```

Options: `--collapse` starts sections closed, `--all` removes the line limits, `--find <text>` (docs) lists only the matching lines, `--json` gives the underlying data instead of the screen, and the display flags of `jpe ui` (`--width`, `--theme`, `--color`, `--unicode`, `--screen-reader`) apply to every view.

## What these views are, and are not

They show **facts the engines measured**: symbols, metrics, pattern matches, diff hunks, language-server and compiler output, retrieved documentation. They are not prose written by a model. The plain-English explanation of why code does what it does stays with Claude (`/jpe:explain`); these screens are what that explanation can be grounded in.

Everything labelled a risk is a **pattern match, worded "possible"**, never a verdict. The review marks each note as **confirmed** (something measured, such as "this line matches an eval pattern" or "this symbol no longer exists") or **heuristic** (a pattern worth a look, such as "source changed and no tests did"). A heuristic is never presented as a finding, and the checklist never says a change is correct.

## The views

### `file`
Code with line numbers and syntax colours on the left, each possible risk drawn under its line with a glyph and a word (`✘ error: high risk: ...`), and the file's structure on the right: symbols with line numbers, measures (code and comment lines, functions, branches, nesting, a complexity score), the concepts in the code with their plain-English meaning from the glossary, and imports. Below 80 columns the two stack. Long files show the first 80 lines and say how many were left out (`--all` shows everything).

### `change`
The uncommitted change to one file against the committed version: hunks with `-` and `+` lines, the symbols added and removed, risk patterns introduced or no longer matching, and a plain note when the file has no committed version or has not changed.

### `review`
Every uncommitted file in one place: an overview table (kind, lines, risks introduced), review notes with their basis, a checklist for the reviewer, and each file's diff as an openable section. Files that could not be analysed (unreadable as text, over 400 KB) are listed with the reason; if none could be, it says so instead of claiming there is nothing to review. Test files are recognised by their path.

### `impact`
Files that depend on a file, most references first, with a bar for each. It says whether the answer is **exact** (from a language server) or **approximate** (found by scanning import statements) and lists what the method cannot see.

### `docs`
The research engine's results: for each source, its provider, trust level, whether its version matches the installed one (in words: "matches the installed version", "a DIFFERENT version", "installed version unknown"), and whether it was fetched fresh this run or is **cached and not re-verified**. Security advisories are raised as errors. Lines that mention deprecation are quoted exactly, and noted when the same line names an alternative; JPE adds none of its own. API signatures from the installed type declarations are shown as code. Retrieved text is untrusted: it is sanitised, instruction-like phrases are flagged ("quoted as data only and was not followed"), and every source is cited. `--find` searches the retrieved text. Offline, only local sources are used and the screen says so.

### `diagnostics`
Findings from the language server (or, if it is not installed, the compiler command, labelled **NOT a language server**), grouped by file, errors first, each with `line:column`, code and message. Messages JPE recognises get a plain-English explanation and a usual fix, **labelled general guidance rather than a diagnosis of your project**. This is the one view that records something: like `jpe lsp diagnostics`, it adds what it observed to the project's evidence ledger.

## Review decisions

`jpe review approve|reject [--note text]` records a reviewer's decision about the uncommitted changes; `jpe review status` and `jpe review history` show where it stands.

- **It records only.** Nothing is committed, staged or changed.
- **It is tied to the exact changes.** The decision stores a fingerprint of every changed path and the hash of each file's content. If any of those files change afterwards, the decision is shown as **stale**, with the old decision named, and is never presented as covering the new state. With no changes left, an old decision is stale too. Review again, then decide again.
- Notes are cleaned to one safe line (500 characters at most). The record keeps the latest 200 decisions, and a damaged file reads as no decisions.
- The command center's home screen shows a Review row and a next step ("2 uncommitted files, and no review decision has been recorded for them"). A rejection of the *current* changes is the only review state that raises a notification.
- `/jpe:review` has Claude explain the review in plain English from these facts. It never records a decision itself.

In the command center pane, press `v` on the home screen to open the review: the overview, the recorded decision, notes and checklist, a button per file that opens its diff, a note box, and **Approve** (`a`) and **Reject** (`x`) buttons that call `jpe review`. Confirmation text appears only after the command line reported success; a failure is shown as a failure.

## Syntax colours

Source code is coloured by four roles (keyword, string, comment, number) that are part of every theme. They are decoration: code is fully readable without colour, and the highlighter only ever colours code, never changes it (a test asserts that the highlighted text of every line equals the original, for every supported language and for hostile input). Languages: JavaScript and TypeScript, Python, Go, Rust, JSON; anything else is shown plain.

Measured contrast on each theme's background (the tests also require 4.5:1 on the raised surface, 7:1 for the high-contrast theme):

| Role | jpe | jpe-contrast | jpe-colorblind | jpe-light |
|---|---|---|---|---|
| keyword | 7.8 | 12.4 | 8.2 | 6.3 |
| string | 11.4 | 16.9 | 13.0 | 6.2 |
| comment | 7.5 | 13.5 | 7.5 | 5.2 |
| number | 8.0 | 12.3 | 9.7 | 5.2 |

## Safety and limits

- Every string shown (file content, retrieved documentation, error messages, file names) is stripped of terminal escape sequences before it is drawn, and every view is held to the terminal width at every size from 20 columns, in Unicode, ASCII and screen-reader modes. Tests cover both with hostile input.
- `change` and `review` compare against `HEAD`; a file with no committed version counts as entirely added. Review looks at the first 40 changed files.
- The syntax highlighter is a small lexer, not a parser: unusual syntax may be left uncoloured. It cannot lose or change code.
- Risk detection is pattern matching. It will flag test code that contains a risky pattern as data (this repository's own tests do), and it cannot see intent. That is why every risk says "possible" and the reviewer's checklist says to read the diffs.
- Only the review is shown inside the command center pane so far (see below). The other views are command-line screens.

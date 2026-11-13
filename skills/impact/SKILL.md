---
description: Shows what else in the project depends on a file or symbol before changing it, using the language server when available and import scanning otherwise. Use before refactors, renames, deletions or API changes.
argument-hint: "<file> [--line N --column N]"
---

# /jpe:impact

Target: `$ARGUMENTS`

## Run

- File-level (works for JavaScript/TypeScript and Python without a language server): `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" impact <file>`
- Symbol-level (exact references via the language server): add `--line N --column N` (1-based position of the symbol's name).
- Check language-server availability first if exactness matters: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" lsp status`. If you have the native `LSP` tool in this session, you may also use it for definitions and references.

For a broader architectural view delegate to the `jpe:jpe-architect` agent.

## Report in plain English

- Which files depend on the target and how heavily, grouped by area of the application.
- What would likely break if the target changed, and what kind of change is safest (adding versus renaming versus removing).
- Which tests cover those dependents, if you can find them (search for test files that import the dependents).
- The method used (language server: exact; import scanning: files that import the module, not individual symbol uses) and its limits, stated clearly. Import scanning misses dynamic imports and re-exports through other packages.

Do not change files.

## Delegating to agents

The `jpe:jpe-*` agents use the plugin's MCP tools (`jpe_*`) and need no extra setup. They cannot edit files or run shell commands. State the question and any file names clearly in the prompt.

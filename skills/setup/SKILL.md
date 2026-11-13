---
description: Checks the JPE installation and this project's readiness (runtime, language servers, configuration), and helps install missing language servers only with the user's explicit approval.
argument-hint: "[language to set up]"
disable-model-invocation: true
---

# /jpe:setup

Target: `$ARGUMENTS`

## Inspect (read-only)

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" checks
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" lsp status
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" config path
```

Summarise in plain English: the languages found, which language servers are ready or missing, and where configuration lives.

## Install a missing language server (only if the user wants it)

1. `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" install-plan <language>` prints the install options for this operating system. It runs nothing.
2. Show the user the exact command, which program will install it and where, and whether the command comes from Claude Code's documentation or is advisory. Ask which option they want. Install only the selected one, and only after a clear yes.
3. Run the approved command with the Bash tool (Claude Code's own permission prompt still applies; never try to avoid it).
4. Confirm it worked: `lsp status` must show the binary, and `lsp diagnostics <a file of that language>` must report a server as the source. If either fails, say what failed. Do not claim success.
5. Tell the user the matching Claude Code plugin to install for native code intelligence, for example `/plugin install typescript-lsp@claude-plugins-official`, and that the server starts the first time Claude edits a file of that type.

## Never

- Install anything, edit global Claude Code settings, or change PATH without explicit approval for that specific action.
- Claim a language server works because the binary exists. Only a successful diagnostics run proves it answers.

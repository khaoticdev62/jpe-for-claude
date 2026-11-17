---
description: Reviews the uncommitted changes. Shows what changed, the possible risks found by pattern matching, and what a reviewer should confirm, then explains each in plain English. Use before committing or merging, or when asked to review the changes. It records no decision unless the user asks.
argument-hint: "[path to focus on]"
---

# /jpe:review

Focus: `$ARGUMENTS` (all uncommitted changes if empty)

## Gather the facts

1. The review screen: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" show review --collapse --width 100`. Add `--json` for the exact data (files, notes, checklist, anything skipped).
2. For a file that needs a closer look: `... show change <path>` (the diff) and `... show file <path>` (the code with possible risks marked).
3. For what else might use something that was changed or removed: `... show impact <file>`.
4. Whether a decision was already recorded, and whether it still applies: `... review status`.

If `$ARGUMENTS` names a path, start with `show change` and `show file` for it, and still read the review overview so the rest of the change is in view.

## Explain, honestly

- **Summary first.** In plain English: what the change does and why, from reading the diffs. Keep the real technical terms in parentheses.
- **Every risk note is a pattern match, not proof.** Open the code behind each one and decide: a real concern, a false positive (for example the pattern appears as test data or in a string), or something a person must decide. Say which, and why. A confirmed note means the pattern matched; it does not mean the code is wrong.
- **Label heuristics as heuristics** (for example "source changed and no tests did"). They are worth a look, not findings.
- **Removed symbols**: check with `show impact` before saying anything uses or does not use them.
- **Never say the change is correct, safe, finished or tested.** Say what you read and what you did not. Offer `/jpe:verify` to run the project's real checks.

## Decisions

Approving or rejecting is the person's decision, not yours. Do not run `review approve` or `review reject` on your own. If the user asks you to record one, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" review approve --note "<their words>"` (or `reject`) and tell them what it means: it only records the decision, nothing is committed, staged or changed, and it shows as stale if any of the reviewed files change afterwards. Never record a decision for changes you did not show them.

Do not change files. Offer `/jpe:fix` for repairs.

## Without a shell

The review screens and decisions need the command line; there is no MCP tool for them. If the Bash tool is unavailable or denied, say so plainly and use `jpe_briefing` (kind: change) on individual files, and do not claim a full review was done.

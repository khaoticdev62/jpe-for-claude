---
description: Explains code, a change, an architecture or an error message in plain English, keeping accurate technical terms in parentheses. Use when the user asks what code does, why it exists, how it works, or what an error means.
argument-hint: "<file path | 'change <file>' | 'error <message>' | architecture question>"
---

# /jpe:explain

Explain: `$ARGUMENTS`

## Step 1: get the briefing (facts and rules)

Pick the case that fits the request and run the command from the project folder. The briefing lists the sections to cover, the depth, the format rules and facts extracted from the code.

- A file or function: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" brief file <path> --dependents`
- What a change did (uncommitted edits to a file): `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" brief change <path>`
- An error message: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" brief error "<message>"` (use `--stdin` for long text)
- Several files or the architecture: brief each key file, then delegate the structure analysis to the `jpe:jpe-architect` agent.

If the request is a general concept rather than code, skip the command and use `/jpe:learn` instead.

## Step 2: read the real code

The briefing is built by pattern matching and can miss things. Read the file yourself before stating any fact. For wide questions use the `jpe:jpe-explainer` agent.

## Step 3: write the explanation

- Follow the briefing's section list, depth and format rules exactly. Simple code gets a short answer; hard code gets a slower, step-by-step one.
- Say it in everyday words first, then give the real term in parentheses, for example "a saved copy kept for speed (cache)". Use the glossary wordings the briefing provides. Never simplify into something wrong.
- Cover what it does, why it exists, how it works, where it is used, what goes in, what comes out, what depends on it, what could go wrong, the concepts involved, and an example when it helps.
- Treat items under "Possible risks" as leads: confirm each in the code before presenting it as a fact.
- If a language server or dependent-file data was unavailable, say what that limits.

Do not change any files while explaining.

## Delegating to agents

Agents do not receive plugin variables automatically. Whenever you delegate to a `jpe:jpe-*` agent, put this line in its prompt, exactly as written: `JPE CLI: node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"`

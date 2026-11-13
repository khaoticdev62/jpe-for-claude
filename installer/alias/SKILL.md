---
name: jpe
description: Alias for JPE For Claude (Just Plain English). Forwards /jpe to the installed JPE plugin and clearly reports when the plugin is not installed in this scope.
argument-hint: "[explain|research|verify|fix|impact|learn|status|audit|setup|config] [arguments]"
disable-model-invocation: true
---
<!-- jpe-alias v1 : installed by the JPE installer; safe to delete, or re-run uninstall to remove -->

# /jpe (alias)

The user typed `/jpe $ARGUMENTS`. This alias exists so that `/jpe` always gives a clear answer, even when the plugin is missing.

## Step 1: find the installed plugin

Use the Read tool on the file `installed_plugins.json` inside Claude Code's plugins folder. That folder is `~/.claude/plugins/` unless the CLAUDE_CONFIG_DIR environment variable points elsewhere (then it is `<CLAUDE_CONFIG_DIR>/plugins/`; on Windows `~` is the user profile folder).

The file has a `plugins` object. Look for a key that starts with `jpe@`. Its value is a list of installs with `scope`, `installPath` and `version`. Pick the install whose scope is `project` or `local` if this project is listed, otherwise the `user` one.

## Step 2: if there is none

Do NOT guess and do NOT pretend anything ran. Tell the user, in plain English:

- The JPE plugin is not installed for this project or for you.
- To install it, run the installer that came with the release (`installer/install.sh` or `installer\install.ps1`), or run: `claude plugin install jpe@jpe-marketplace`
- If they only wanted to use it for one session: `claude --plugin-dir <path to the plugin folder>`.

Then stop.

## Step 3: if it is installed

Let PLUGIN be the `installPath` from step 1. Read `PLUGIN/skills/jpe/SKILL.md` with the Read tool and follow it exactly, with these substitutions:

- Wherever it uses the plugin-root placeholder (dollar sign, brace, CLAUDE_PLUGIN_ROOT, brace), use the PLUGIN folder.
- Its user input (`$ARGUMENTS`) is: `$ARGUMENTS`
- Ignore that file's front matter.

If PLUGIN does not exist on disk, tell the user the install record is stale and suggest reinstalling.

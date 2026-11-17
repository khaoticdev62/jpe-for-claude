/**
 * The commands the command center can launch: JPE's real slash commands, described once.
 *
 * A test compares this list with the skill files in `skills/`, so a command cannot be added, renamed or made
 * state-changing in one place and forgotten in the other.
 */

export const COMMAND_GROUPS = ["Understand", "Check", "Change", "Manage"] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface CenterCommand {
  /** The sub-command word: `verify` for `/jpe verify`. Also the skill's folder name. */
  id: string;
  /** The slash command that runs it, as Claude Code names it. */
  slash: string;
  title: string;
  /** One plain-English line. */
  summary: string;
  group: CommandGroup;
  /** Shown after the command when it takes an argument: `<file or topic>`. */
  argHint?: string;
  /** True when the command can change files, settings or installed software, so the center asks before running it. */
  changesThings: boolean;
  /** Extra words people search by. */
  keywords: readonly string[];
}

const command = (id: string, title: string, summary: string, group: CommandGroup, changesThings: boolean, keywords: readonly string[], argHint?: string): CenterCommand => ({
  id,
  slash: `jpe:${id}`,
  title,
  summary,
  group,
  changesThings,
  keywords,
  ...(argHint === undefined ? {} : { argHint }),
});

export const CENTER_COMMANDS: readonly CenterCommand[] = [
  command("explain", "Explain", "Explain code in everyday English, with the real technical terms in parentheses", "Understand", false, ["what does", "walk through", "describe", "understand", "plain english"], "<file or topic>"),
  command("research", "Research", "Look up the official documentation for the exact installed version, with sources", "Understand", false, ["docs", "documentation", "api", "version", "library", "deprecated"], "<library>"),
  command("learn", "Learn", "Learn a programming concept using this project's own code", "Understand", false, ["teach", "concept", "tutorial", "lesson"], "<concept>"),
  command("impact", "Impact", "See what else depends on a file before you change it", "Understand", false, ["dependents", "refactor", "rename", "blast radius", "who uses"], "<file>"),
  command("verify", "Verify", "Run the project's real tests, type checks and build, and report evidence", "Check", false, ["test", "build", "lint", "typecheck", "does it work", "check"]),
  command("status", "Status", "Show the latest verification status and what backs it", "Check", false, ["result", "last run", "evidence", "passed", "failed"]),
  command("audit", "Audit", "Review the project for risky patterns and exposed credentials", "Check", false, ["security", "secrets", "vulnerabilities", "safe", "review"]),
  command("review", "Review", "Review the uncommitted changes: what changed, possible risks, and what to confirm", "Check", false, ["changes", "diff", "pull request", "approve", "reject", "look over", "before commit"], "<path>"),
  command("fix", "Fix", "Investigate a failure and repair it in small, checked steps with a backup", "Change", true, ["repair", "bug", "broken", "error", "failing", "debug"]),
  command("setup", "Setup", "Check JPE's health and set up language servers", "Manage", true, ["doctor", "install", "health", "language server", "diagnose"]),
  command("config", "Config", "View or change JPE's settings", "Manage", true, ["settings", "preferences", "theme", "options", "configure"]),
];

export const findCommand = (id: string): CenterCommand | undefined => CENTER_COMMANDS.find((c) => c.id === id);

export const isCommandId = (id: string): boolean => findCommand(id) !== undefined;

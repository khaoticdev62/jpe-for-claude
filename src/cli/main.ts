import { isJpeError } from "../core/errors.js";
import { redactSecrets } from "../core/redact.js";
import { auditCommand, backupCommand, configCommand, scanCommand } from "./commands/admin.js";
import { briefCommand } from "./commands/brief.js";
import { centerCommand } from "./commands/center.js";
import { doctorCommand } from "./commands/doctor.js";
import { impactCommand, installPlanCommand, lspCommand } from "./commands/lsp.js";
import { researchCommand } from "./commands/research.js";
import { agentsCommand } from "./commands/agents.js";
import { resumeCommand, sessionsCommand, taskCommand } from "./commands/workspace.js";
import { reviewCommand } from "./commands/review.js";
import { showCommand } from "./commands/show.js";
import { uiCommand } from "./commands/ui.js";
import { checksCommand, statusCommand, verifyCommand } from "./commands/verify.js";
import { flagBool, parseArgs, type ParsedArgs } from "./args.js";
import type { CliContext } from "./context.js";

type Handler = (args: ParsedArgs, ctx: CliContext) => Promise<number>;

const COMMANDS: Readonly<Record<string, { run: Handler; help: string }>> = {
  brief: { run: briefCommand, help: "brief file <path> [--dependents] [--phase before|after] | change <path> | error <message>|--stdin   Explanation briefing" },
  research: { run: researchCommand, help: "research <library> [--topic t] [--version v] [--offline]   Version-aware documentation research" },
  checks: { run: checksCommand, help: "checks   What this project is and which verification commands it has" },
  verify: { run: verifyCommand, help: "verify [--baseline] [--only a,b]   Run the project's checks and report an evidence-based status" },
  status: { run: statusCommand, help: "status   Status of the latest verify run" },
  lsp: { run: lspCommand, help: "lsp status | lsp diagnostics <file...>   Language-server state and diagnostics" },
  impact: { run: impactCommand, help: "impact <file> [--line N --column N]   Which files depend on this one" },
  "install-plan": { run: installPlanCommand, help: "install-plan <language>   Show (never run) language-server install options" },
  config: { run: configCommand, help: "config show | path | set <key> <value> [--project] | export [--out f] | import <f>   Configuration" },
  backup: { run: backupCommand, help: "backup create <files...> | seal <id> | verify <id> | rollback <id> [--force] | list | prune   Backups and rollback" },
  scan: { run: scanCommand, help: "scan [paths...]   Look for credentials (values are never printed)" },
  audit: { run: auditCommand, help: "audit   Static review for risky patterns" },
  center: { run: centerCommand, help: "center [home|palette <query>|hud] [--json] [display flags]   The command center: project facts, next steps and the command palette, as text" },
  resume: { run: resumeCommand, help: "resume [--json]   Where you left off: project facts, the last session and your open tasks" },
  sessions: { run: sessionsCommand, help: "sessions [--json]   Recent sessions JPE recorded (when they started, files edited and backed up)" },
  task: { run: taskCommand, help: "task add <text> | list [--all] | done <number> | remove <number> [--json]   Your task list for this project" },
  agents: { run: agentsCommand, help: "agents [--json]   Agent runs Claude Code reported in this project: running or finished, how long they took, and use by type" },
  review: { run: reviewCommand, help: "review approve|reject [--note text] | status | history [--json]   Record a review decision about the uncommitted changes (it records only, and goes stale if the files change)" },
  show: { run: showCommand, help: "show file <path> | change <path> | review | impact <file> | docs <library> | diagnostics <files...> [--collapse] [--all] [--find text] [--json] [display flags]   Rich views of what JPE found" },
  ui: { run: uiCommand, help: "ui [preview|keys] [--theme t] [--color c] [--unicode on|off] [--width n] [--density d] [--motion m] [--screen-reader] [--json]   Terminal capabilities and a live sample of the JPE design system" },
  doctor: { run: doctorCommand, help: "doctor [--deep] [--repair] [--export file] [--json]   Health check of the plugin, hooks, agents, MCP, language servers, cache and backups" },
};

export const COMMAND_NAMES: readonly string[] = Object.keys(COMMANDS);

function helpText(): string {
  return ["JPE For Claude command line", "", "Usage: jpe <command> [options]", "", ...Object.values(COMMANDS).map((c) => `  ${c.help}`)].join("\n");
}

/** Runs one CLI invocation and returns its exit code. Errors become short plain-English messages, never stack traces. */
export async function runCli(argv: readonly string[], ctx: CliContext): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help") {
    ctx.out(helpText());
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) {
    ctx.err(`jpe: unknown command "${name}".\n\n${helpText()}`);
    return 64;
  }
  const args = parseArgs(rest);
  if (flagBool(args, "help")) {
    ctx.out(command.help);
    return 0;
  }
  try {
    return await command.run(args, ctx);
  } catch (error) {
    if (isJpeError(error)) {
      ctx.err(`jpe: ${redactSecrets(error.userMessage)}`);
      return 1;
    }
    ctx.err("jpe: something unexpected went wrong. Re-run with JPE_DEBUG=1 for details.");
    if (process.env["JPE_DEBUG"] === "1") ctx.err(redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)));
    return 2;
  }
}

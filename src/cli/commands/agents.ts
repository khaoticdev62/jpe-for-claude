import { agentsView } from "../../agents/views.js";
import { agentsSentence, buildMetrics, buildRuns, summarize } from "../../agents/runs.js";
import { loadAgentEvents } from "../../agents/store.js";
import { paint } from "../../ui/paint.js";
import { flagBool, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { renderContext } from "./render-profile.js";

/**
 * `jpe agents [--json]`
 *
 * Shows the agent runs Claude Code reported in this project (start and stop events), how long finished runs took, and how
 * often each agent type ran. Read-only. It never starts, stops or changes an agent.
 */
export async function agentsCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const now = ctx.now();
  const runs = buildRuns(await loadAgentEvents(ctx), now);
  const metrics = buildMetrics(runs);
  if (flagBool(args, "json")) {
    ctx.out(JSON.stringify({ summary: { ...summarize(runs), sentence: agentsSentence(summarize(runs)) }, runs, metrics }, null, 2));
    return 0;
  }
  const { profile } = await renderContext(args, ctx);
  ctx.out(paint(agentsView(runs, metrics, now, profile), profile));
  return 0;
}

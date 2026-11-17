import { collectHud } from "../../center/hud.js";
import { buildHome, buildPaletteText, homeActions, hudLines } from "../../center/home.js";
import { EMPTY_MEMORY } from "../../center/memory.js";
import { rankCommands } from "../../center/palette.js";
import { suggest } from "../../center/suggestions.js";
import { JpeError } from "../../core/errors.js";
import { heading } from "../../ui/components.js";
import { paint } from "../../ui/paint.js";
import { flagBool, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { renderContext } from "./render-profile.js";

/**
 * `jpe center [home|palette <query>|hud] [--json]`: the command center's screens as text, from real project facts.
 * Read-only. This is also what shows when a pane cannot be drawn, and what the in-Claude-Code interface reads its
 * data from (`jpe center hud --json`). Favourites and history live in the interface, so here they start empty.
 */
export async function centerCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const view = args.positionals[0] ?? "home";
  if (view !== "home" && view !== "palette" && view !== "hud") throw new JpeError("INVALID_INPUT", `Unknown view "${view}". Use "jpe center", "jpe center palette <query>" or "jpe center hud".`);

  const json = flagBool(args, "json");
  const { profile } = await renderContext(args, ctx);

  if (view === "palette") {
    const query = args.positionals.slice(1).join(" ");
    if (json) {
      ctx.out(JSON.stringify(rankCommands(query, EMPTY_MEMORY).map((e) => ({ id: e.command.id, slash: `/${e.command.slash}`, title: e.command.title, summary: e.command.summary, changesThings: e.command.changesThings, score: e.score })), null, 2));
      return 0;
    }
    ctx.out(paint(buildPaletteText(query, EMPTY_MEMORY, profile), profile));
    return 0;
  }

  const hud = await collectHud(ctx);
  if (view === "hud") {
    ctx.out(json ? JSON.stringify(hud, null, 2) : paint([...heading("Project facts", profile), ...hudLines(hud, profile, ctx.now())], profile));
    return 0;
  }
  if (json) {
    ctx.out(JSON.stringify({ hud, suggestions: suggest(hud), actions: homeActions(hud, EMPTY_MEMORY) }, null, 2));
    return 0;
  }
  ctx.out(paint(buildHome(hud, EMPTY_MEMORY, profile, ctx.now()), profile));
  return 0;
}

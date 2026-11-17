import { JpeError } from "../../core/errors.js";
import { blank, bulletList, heading, statusBadge, table } from "../../ui/components.js";
import type { Line } from "../../ui/doc.js";
import { ACTIONS, chordLabel } from "../../ui/keymap.js";
import { paint } from "../../ui/paint.js";
import { buildPreview, summarizeProfile } from "../../ui/preview.js";
import type { RenderProfile } from "../../ui/profile.js";
import { flagBool, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { renderContext } from "./render-profile.js";

function keysScreen(profile: RenderProfile): Line[] {
  const rows = ACTIONS.map((action) => [action, profile.keymap.byAction[action].map(chordLabel).join(", ")]);
  const problems = profile.keymap.problems.flatMap((problem) => statusBadge("warning", `${problem.action}: ${problem.message}`, profile));
  return [
    ...heading("Keyboard shortcuts", profile),
    ...table({ columns: [{ header: "Action" }, { header: "Keys" }], rows }, profile),
    blank(),
    ...(problems.length === 0 ? bulletList(["Digits 1 to 9 jump to the matching numbered item in any list."], profile) : [...heading("Shortcut settings that were ignored", profile), ...problems]),
  ];
}

/**
 * `jpe ui [preview|keys] [--theme t] [--color c] [--unicode on|off] [--width n] [--density d] [--motion m] [--screen-reader] [--json]`
 * Shows what JPE detected about this terminal and a live sample of how it will draw. Changes nothing.
 */
export async function uiCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const view = args.positionals[0] ?? "preview";
  if (view !== "preview" && view !== "keys") throw new JpeError("INVALID_INPUT", `Unknown view "${view}". Use "jpe ui" or "jpe ui keys".`);

  const { caps, profile } = await renderContext(args, ctx);

  if (flagBool(args, "json")) {
    const payload = view === "keys" ? { byAction: profile.keymap.byAction, problems: profile.keymap.problems } : { profile: summarizeProfile(profile), reasons: caps.reasons, shortcutProblems: profile.keymap.problems };
    ctx.out(JSON.stringify(payload, null, 2));
    return 0;
  }
  ctx.out(paint(view === "keys" ? keysScreen(profile) : buildPreview(caps, profile), profile));
  return 0;
}

import path from "node:path";
import { JpeError } from "../../core/errors.js";
import { buildChangeBriefing, buildErrorBriefing, buildFileBriefing } from "../../explain/briefing.js";
import { summarizeChange } from "../../explain/diff.js";
import { listProjectFiles } from "../../lsp/detect.js";
import { impactViaText } from "../../lsp/impact.js";
import { resolveInside } from "../../security/paths.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";

/** Reads a text file inside the project (never outside it), or throws a plain-English error. Shared with `jpe show`. */
export async function readProjectFile(ctx: CliContext, rel: string | undefined): Promise<{ abs: string; rel: string; text: string }> {
  if (!rel) throw new JpeError("INVALID_INPUT", "Give the path of a file inside the project.");
  const abs = resolveInside(ctx.cwd, rel);
  const text = await ctx.fs.readText(abs);
  if (text === undefined) throw new JpeError("INVALID_INPUT", `"${rel}" is not a readable file in this project.`);
  return { abs, rel: path.relative(ctx.cwd, abs).split(path.sep).join("/"), text };
}

/** `jpe brief file|change|error`: prints the explanation briefing that Claude turns into plain English. */
export async function briefCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const [kind, ...rest] = args.positionals;
  const cfg = (await ctx.loadConfig()).explanation;

  if (kind === "file") {
    const file = await readProjectFile(ctx, rest[0]);
    let dependents: string[] | undefined;
    if (flagBool(args, "dependents")) {
      const impact = await impactViaText(file.rel, { root: ctx.cwd, listFiles: () => listProjectFiles(ctx.cwd, ctx.git), readText: (f) => ctx.fs.readText(f) });
      dependents = impact.referencingFiles.map((r) => path.relative(ctx.cwd, r.file).split(path.sep).join("/"));
    }
    const phase = flagString(args, "phase");
    const briefing = buildFileBriefing({ file: file.rel, content: file.text, ...(dependents ? { dependents } : {}), ...(phase === "before" || phase === "after" ? { phase } : {}) }, cfg);
    ctx.out(briefing.text);
    return 0;
  }

  if (kind === "change") {
    const file = await readProjectFile(ctx, rest[0]);
    const before = await ctx.git(["show", `HEAD:${file.rel}`]);
    const note = before.exitCode === 0 ? "" : `NOTE: ${file.rel} has no committed version (new file or no git history), so the whole file counts as added.\n`;
    const summary = summarizeChange(file.rel, before.exitCode === 0 ? before.stdout : "", file.text);
    ctx.out(note + buildChangeBriefing(summary, cfg).text);
    return 0;
  }

  if (kind === "error") {
    const message = flagBool(args, "stdin") ? await ctx.readStdin() : rest.join(" ");
    if (message.trim() === "") throw new JpeError("INVALID_INPUT", "Give the error message as text, or pipe it in with --stdin.");
    ctx.out(buildErrorBriefing(message.slice(0, 8000), cfg).text);
    return 0;
  }

  throw new JpeError("INVALID_INPUT", "Usage: jpe brief file <path> [--dependents] [--phase before|after] | change <path> | error <message>|--stdin");
}

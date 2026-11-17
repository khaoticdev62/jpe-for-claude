import path from "node:path";
import { JpeError } from "../../core/errors.js";
import { analyzeCode } from "../../explain/analyze.js";
import { summarizeChange } from "../../explain/diff.js";
import { readGitState } from "../../project/git.js";
import { changeView, checklist, fileView, reviewNotes, reviewView, type ReviewFile } from "../../show/explain-views.js";
import { diagnosticsView, docsView, impactView } from "../../show/intel-views.js";
import { paint } from "../../ui/paint.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { readProjectFile } from "./brief.js";
import { collectDiagnostics, computeImpact } from "./lsp.js";
import { renderContext } from "./render-profile.js";
import { runResearch } from "./research.js";

const VIEWS = ["file", "change", "review", "impact", "docs", "diagnostics"] as const;
type View = (typeof VIEWS)[number];

const USAGE = `Usage: jpe show <${VIEWS.join("|")}> ...
  file <path>              a file's code with possible risks marked, beside its structure
  change <path>            one file's uncommitted change as a diff
  review                   every uncommitted change: overview, notes, checklist, diffs
  impact <file>            what depends on a file
  docs <library>           official documentation for the installed version
  diagnostics <files...>   compiler or language-server findings`;

const MAX_FILE_LINES = 80;
const MAX_HUNK_LINES = 40;
const MAX_REVIEW_FILES = 40;
const MAX_REVIEW_BYTES = 400_000;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[a-z0-9]+$/i;

async function beforeText(ctx: CliContext, rel: string): Promise<string | undefined> {
  const result = await ctx.git(["show", `HEAD:${rel}`]);
  return result.exitCode === 0 ? result.stdout : undefined;
}

/** Every uncommitted file as a change summary, with the ones that could not be analysed listed with the reason. */
async function reviewFiles(ctx: CliContext): Promise<{ files: ReviewFile[]; skipped: string[] }> {
  const state = await readGitState(ctx.git);
  if (!state.available) throw new JpeError("TOOL_UNAVAILABLE", "Git is not installed, so there is nothing to compare against.");
  if (!state.isRepo) throw new JpeError("INVALID_INPUT", "This folder is not a git repository, so there is no committed version to compare against.");
  const top = await ctx.git(["rev-parse", "--show-toplevel"]);
  const root = top.exitCode === 0 && top.stdout.trim() !== "" ? top.stdout.trim() : ctx.cwd;

  const files: ReviewFile[] = [];
  const skipped: string[] = [];
  for (const changed of state.changedFiles.slice(0, MAX_REVIEW_FILES)) {
    const rel = changed.path;
    const deleted = changed.status.includes("D");
    const added = changed.status.includes("?") || changed.status.includes("A");
    const after = deleted ? "" : await ctx.fs.readText(path.resolve(root, rel));
    if (after === undefined) {
      skipped.push(`${rel} (not readable as text)`);
      continue;
    }
    const before = added ? "" : ((await beforeText(ctx, rel)) ?? "");
    if (before.length > MAX_REVIEW_BYTES || after.length > MAX_REVIEW_BYTES) {
      skipped.push(`${rel} (over ${MAX_REVIEW_BYTES / 1000} KB)`);
      continue;
    }
    files.push({ summary: summarizeChange(rel, before, after), status: deleted ? "deleted" : added ? "added" : "modified", isTest: TEST_PATH.test(rel) });
  }
  if (state.changedFiles.length > MAX_REVIEW_FILES) skipped.push(`${state.changedFiles.length - MAX_REVIEW_FILES} more changed files beyond the first ${MAX_REVIEW_FILES}`);
  return { files, skipped };
}

/**
 * `jpe show <file|change|review|impact|docs|diagnostics> ...`: rich, width-aware views of what JPE's engines found.
 * `--json` gives the underlying data. `--collapse` starts sections closed; `--all` removes the line limits.
 * Read-only, except that `diagnostics` records what it observed in the evidence ledger, as `jpe lsp diagnostics` does.
 */
export async function showCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const view = args.positionals[0] as View | undefined;
  if (view === undefined || !VIEWS.includes(view)) throw new JpeError("INVALID_INPUT", USAGE);

  const { profile } = await renderContext(args, ctx);
  const json = flagBool(args, "json");
  const expanded = !flagBool(args, "collapse");
  const all = flagBool(args, "all");
  const rest = args.positionals.slice(1);
  const emit = (data: unknown, lines: () => Parameters<typeof paint>[0]): number => {
    ctx.out(json ? JSON.stringify(data, null, 2) : paint(lines(), profile));
    return 0;
  };

  if (view === "file") {
    const file = await readProjectFile(ctx, rest[0]);
    const analysis = analyzeCode(file.rel, file.text);
    return emit(analysis, () => fileView(analysis, file.text, profile, { expanded, maxLines: all ? Number.MAX_SAFE_INTEGER : MAX_FILE_LINES }));
  }

  if (view === "change") {
    const file = await readProjectFile(ctx, rest[0]);
    const before = await beforeText(ctx, file.rel);
    const summary = summarizeChange(file.rel, before ?? "", file.text);
    const note = before === undefined ? `${file.rel} has no committed version (a new file, or no git history), so every line counts as added.\n` : "";
    return emit(summary, () => [...(note === "" ? [] : [[{ text: note.trim(), role: "muted" as const }]]), ...changeView(summary, profile, { maxHunkLines: all ? Number.MAX_SAFE_INTEGER : MAX_HUNK_LINES })]);
  }

  if (view === "review") {
    const { files, skipped } = await reviewFiles(ctx);
    return emit({ files: files.map((f) => ({ status: f.status, isTest: f.isTest, summary: f.summary })), notes: reviewNotes(files), checklist: checklist(files), skipped }, () =>
      reviewView(files, profile, { expanded, maxHunkLines: all ? Number.MAX_SAFE_INTEGER : MAX_HUNK_LINES, skipped }),
    );
  }

  if (view === "impact") {
    const run = await computeImpact(rest[0], Number(flagString(args, "line")), Number(flagString(args, "column")), ctx);
    const rel = (file: string): string => path.relative(ctx.cwd, file).split(path.sep).join("/") || file;
    return emit({ report: run.report, notes: run.notes }, () => impactView(run.report, rel(run.abs), run.notes, rel, profile));
  }

  if (view === "docs") {
    const { report, versionNote } = await runResearch({ positionals: rest, flags: args.flags }, ctx);
    const find = flagString(args, "find");
    return emit({ versionNote, report: { ...report, results: report.results.map((r) => ({ ...r, content: r.content.slice(0, 4000) })) } }, () => docsView(report, versionNote, profile, { expanded, ...(find === undefined ? {} : { find }) }));
  }

  const run = await collectDiagnostics(rest, ctx);
  const rel = (file: string): string => path.relative(ctx.cwd, file).split(path.sep).join("/") || file;
  return emit(run, () => diagnosticsView(run.report, run.notes, rel, profile, { expanded }));
}

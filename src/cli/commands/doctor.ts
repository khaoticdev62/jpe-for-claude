import { applyRepairs, exportDoctor, formatDoctor, runDoctor } from "../../doctor/doctor.js";
import { resolveInside } from "../../security/paths.js";
import { flagBool, flagString, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";

/** `jpe doctor [--deep] [--repair] [--export file] [--json]`: a real health check with plain-English advice. */
export async function doctorCommand(args: ParsedArgs, ctx: CliContext): Promise<number> {
  const env = { ctx, pluginRoot: ctx.pluginRoot, deep: flagBool(args, "deep"), nodeVersion: process.version };
  let report = await runDoctor(env);
  if (flagBool(args, "repair")) report = await applyRepairs(env, report);

  const exportTo = flagString(args, "export");
  if (exportTo) {
    await ctx.writeText(resolveInside(ctx.cwd, exportTo), exportDoctor(report));
  }
  ctx.out(flagBool(args, "json") ? exportDoctor(report) : formatDoctor(report) + (exportTo ? `\nReport exported to ${exportTo} (home folder replaced by ~, credentials redacted).` : ""));
  return report.overall === "fail" ? 1 : 0;
}

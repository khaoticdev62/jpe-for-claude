import os from "node:os";
import { redactSecrets } from "../core/redact.js";
import { checkBackups, checkCache, checkConfig, checkLanguageServers, checkNetwork, checkOffline, checkProject, checkRuntime, checkStorage, repair } from "./env-checks.js";
import { checkPlugin } from "./plugin-checks.js";
import { ORDER, type DoctorEnv, type DoctorReport, type Finding, type FindingStatus, type RepairId } from "./types.js";

/** Runs every check. A check that crashes is reported as a failed check instead of stopping the report. */
export async function runDoctor(env: DoctorEnv): Promise<DoctorReport> {
  const checks: Array<[string, () => Promise<Finding[]>]> = [
    ["runtime", () => checkRuntime(env)],
    ["plugin", () => checkPlugin(env)],
    ["config", () => checkConfig(env)],
    ["storage", () => checkStorage(env)],
    ["project", () => checkProject(env)],
    ["language servers", () => checkLanguageServers(env)],
    ["documentation cache", () => checkCache(env)],
    ["network", () => checkNetwork(env)],
    ["backups", () => checkBackups(env)],
    ["offline", () => checkOffline(env)],
  ];
  const findings: Finding[] = [];
  for (const [name, run] of checks) {
    try {
      findings.push(...(await run()));
    } catch {
      findings.push({ id: `crash-${name}`, area: "Doctor", status: "warn", title: `The ${name} check could not complete.`, fix: "Re-run with JPE_DEBUG=1, or report this." });
    }
  }
  const overall = findings.reduce<FindingStatus>((worst, x) => (ORDER[x.status] > ORDER[worst] ? x.status : worst), "ok");
  return { generatedAt: env.ctx.now().toISOString(), overall, findings, repairs: [] };
}

/** Performs the safe local repairs that the findings point to. Returns the report with what was done. */
export async function applyRepairs(env: DoctorEnv, report: DoctorReport): Promise<DoctorReport> {
  const ids = [...new Set(report.findings.flatMap((x) => (x.repair ? [x.repair] : [])))] as RepairId[];
  const repairs: DoctorReport["repairs"] = [];
  for (const id of ids) {
    try {
      repairs.push({ id, done: true, message: await repair(env, id) });
    } catch {
      repairs.push({ id, done: false, message: "The repair failed; nothing further was changed." });
    }
  }
  return { ...report, repairs };
}

const ICON: Record<FindingStatus, string> = { ok: "OK  ", info: "INFO", warn: "WARN", fail: "FAIL" };

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces the home folder (either slash style, any letter case) with ~ and removes anything credential-shaped. */
export function sanitize(text: string): string {
  const home = os.homedir();
  let out = text;
  if (home) {
    const variants = [home, home.replaceAll("\\", "/")].map(escapeRegex).join("|");
    out = out.replace(new RegExp(variants, "gi"), "~");
  }
  return redactSecrets(out);
}

function sanitizeDeep<T>(value: T): T {
  if (typeof value === "string") return sanitize(value) as T;
  if (Array.isArray(value)) return value.map(sanitizeDeep) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v)])) as T;
  return value;
}

export function formatDoctor(report: DoctorReport): string {
  const lines = [`JPE Doctor: ${report.overall === "ok" ? "everything checked is healthy" : report.overall === "warn" ? "works, with things worth fixing" : "problems found"}`, ""];
  let area = "";
  for (const x of report.findings) {
    if (x.area !== area) {
      area = x.area;
      lines.push(`${area}`);
    }
    lines.push(`  [${ICON[x.status]}] ${x.title}`);
    if (x.detail) lines.push(`         ${x.detail}`);
    if (x.fix && (x.status === "warn" || x.status === "fail" || x.repair)) lines.push(`         Fix: ${x.fix}`);
    if (x.repair && x.status !== "ok") lines.push(`         (a safe automatic repair exists: jpe doctor --repair)`);
  }
  if (report.repairs.length > 0) lines.push("", "Repairs performed:", ...report.repairs.map((r) => `  ${r.done ? "done" : "FAILED"}: ${r.message}`));
  lines.push("", "Doctor only checks what it can truly test; INFO lines are things it could not or did not test.");
  return sanitize(lines.join("\n"));
}

/** JSON export for sharing. Values are cleaned BEFORE encoding, because JSON doubles backslashes and would hide Windows paths from a text replace. */
export function exportDoctor(report: DoctorReport): string {
  return `${JSON.stringify(sanitizeDeep(report), null, 2)}\n`;
}

/**
 * Screens for the lifecycle commands. Pure: they draw the facts they are given and change nothing.
 */

import { formatAge } from "../center/home.js";
import { blank, bulletList, heading, keyValues, statusBadge, table, textLines } from "../ui/components.js";
import type { Line } from "../ui/doc.js";
import type { RenderProfile } from "../ui/profile.js";
import { inline } from "../ui/text.js";
import { type DirStats, formatBytes, type Inventory, type RemovalPlan, type RemovalResult } from "./inventory.js";
import type { UpdateCheck } from "./version.js";

export type CheckOutcome = UpdateCheck | { state: "skipped"; reason: string };

export interface AboutFacts {
  version: string;
  /** The version in the plugin manifest on disk, when it could be read. */
  manifestVersion?: string;
  pluginRoot?: string;
  dataRoot: string;
  settingsFiles: Array<{ label: string; path: string; exists: boolean }>;
  /** `plugin@marketplace` as Claude Code knows it, when the marketplace file could be read. */
  pluginId?: string;
  check?: CheckOutcome;
}

export function aboutView(facts: AboutFacts, profile: RenderProfile): Line[] {
  const out: Line[] = [...heading(`JPE For Claude ${facts.version}`, profile)];
  const mismatch = facts.manifestVersion !== undefined && facts.manifestVersion !== facts.version;
  out.push(...statusBadge(mismatch ? "warning" : "success", mismatch ? `The built code is ${facts.version} but the plugin manifest says ${facts.manifestVersion}: it is out of date.` : "The built code and the plugin manifest agree on the version.", profile));
  out.push(
    blank(),
    ...keyValues(
      [
        ["Version", facts.version],
        ["Plugin folder", facts.pluginRoot === undefined ? "not found (running outside a plugin folder)" : inline(facts.pluginRoot)],
        ["Data folder", inline(facts.dataRoot)],
      ],
      profile,
    ),
    ...facts.settingsFiles.flatMap((s) => textLines(`${s.label}: ${inline(s.path)} ${s.exists ? "(exists)" : "(not created: defaults are in use)"}`, profile.width)),
  );
  if (facts.check !== undefined) out.push(blank(), ...checkLines(facts.check, profile));
  const id = facts.pluginId ?? "<plugin>";
  out.push(
    blank(),
    ...heading("Update and uninstall", profile),
    ...bulletList(
      [
        `Update: \`claude plugin update ${id}\`, then restart Claude Code. JPE tells you once, at the next session start, when its version changed.`,
        `Uninstall: \`claude plugin uninstall ${id}\`. Claude Code removes the plugin's data folder too; add --keep-data to keep it.`,
        "Check for a newer version: `jpe about --check` (needs the network; offline mode refuses it).",
        "See or clear what JPE stores: `jpe data`.",
      ],
      profile,
    ),
  );
  return out;
}

function checkLines(check: CheckOutcome, profile: RenderProfile): Line[] {
  switch (check.state) {
    case "up-to-date":
      return statusBadge("success", `You have the latest published version (${check.latest}).`, profile);
    case "update-available":
      return statusBadge("info", `A newer version is published: ${check.latest} (you have ${check.installed}).`, profile);
    case "ahead":
      return statusBadge("info", `You have ${check.installed}, which is newer than the latest published version (${check.latest}): a development build.`, profile);
    case "unknown":
      return [...statusBadge("warning", "Could not tell whether there is a newer version.", profile), ...textLines(check.reason, profile.width, { role: "muted" })];
    case "skipped":
      return [...statusBadge("inactive", "Did not check for a newer version.", profile), ...textLines(check.reason, profile.width, { role: "muted" })];
  }
}

const sizeText = (s: DirStats): string => (s.files === 0 ? "empty" : `${s.files}${s.truncated ? "+" : ""} ${s.files === 1 ? "file" : "files"}, ${formatBytes(s.bytes)}`);

export function dataView(inv: Inventory, now: Date, profile: RenderProfile): Line[] {
  const out: Line[] = [...heading("What JPE stores", profile)];
  out.push(...keyValues([["Folder", inline(inv.root)], ["Total", sizeText(inv.total)]], profile));
  out.push(blank(), ...table({ columns: [{ header: "What", min: 14 }, { header: "Size", min: 10 }], rows: [["Settings (and backups of them)", sizeText(inv.settings)], ["Documentation cache", sizeText(inv.docsCache)], ["Other (version record)", sizeText(inv.other)]] }, profile));
  if (inv.projects.length > 0) {
    out.push(blank(), ...heading("Per project", profile));
    out.push(
      ...table(
        { columns: [{ header: "Project", min: 10 }, { header: "Records", min: 8 }, { header: "File backups", min: 8 }, { header: "Last used", min: 8 }], rows: inv.projects.map((p) => [`${p.key}${p.current ? " (this one)" : ""}`, sizeText(p.records), sizeText(p.backups), p.records.newestMs === 0 && p.backups.newestMs === 0 ? "never" : formatAge(new Date(Math.max(p.records.newestMs, p.backups.newestMs)).toISOString(), now)]) },
        profile,
      ),
    );
  }
  out.push(
    blank(),
    ...bulletList(
      [
        "Records are tasks, review decisions, agent activity, the event log, the verification record and session records. Backups are copies of files Claude edited, kept so you can roll back.",
        "Nothing is stored in your project except `.jpe/config.json`, which is yours and is never touched here.",
        "`jpe data remove cache|records|backups|all` shows exactly what would be deleted. Nothing is deleted until you add --confirm.",
      ],
      profile,
    ),
  );
  return out;
}

export function removalView(plan: RemovalPlan, root: string, result: RemovalResult | undefined, profile: RenderProfile): Line[] {
  const out: Line[] = [...heading(`Remove: ${plan.scope}`, profile)];
  if (plan.targets.length === 0 || plan.stats.files === 0) {
    out.push(...textLines(result === undefined ? "Nothing to remove: that part is already empty." : "Nothing was removed: that part is already empty.", profile.width));
    return out;
  }
  out.push(...textLines(`${result === undefined ? "Would delete" : "Deleted"} ${sizeText(plan.stats)} from ${inline(root)}.`, profile.width), blank(), ...bulletList(plan.consequences, profile));
  if (result === undefined) {
    out.push(blank(), ...textLines("Nothing has been deleted. To go ahead, run the same command again with --confirm.", profile.width, { role: "muted" }));
    return out;
  }
  out.push(blank(), ...statusBadge(result.failed.length === 0 ? "success" : "warning", result.failed.length === 0 ? `Removed ${result.removed.length} ${result.removed.length === 1 ? "item" : "items"}.` : `Removed ${result.removed.length}; ${result.failed.length} could not be removed.`, profile));
  for (const f of result.failed) out.push(...textLines(`${inline(f.target)}: ${inline(f.reason)}`, profile.width, { role: "muted" }));
  return out;
}

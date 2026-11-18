/**
 * Screens for offline status and the event log. Pure: they draw what they are given and change nothing.
 */

import { formatAge } from "../center/home.js";
import { blank, bulletList, heading, keyValues, statusBadge, table, textLines } from "../ui/components.js";
import type { Line } from "../ui/doc.js";
import type { RenderProfile } from "../ui/profile.js";
import { inline } from "../ui/text.js";
import type { LogEntry, LogLevel } from "./log.js";

export interface OfflineFacts {
  offline: boolean;
  /** Where the mode comes from. */
  source: "default" | "global" | "project" | "environment";
  cachedDocs: number;
  providers: ReadonlyArray<{ name: string; needsNetwork: boolean }>;
}

const SOURCE_WORDS: Record<OfflineFacts["source"], string> = { default: "the default", global: "your settings", project: "this project's settings", environment: "the JPE_OFFLINE environment variable" };

/** What offline mode does here, and what is still available, without overstating either. */
export function offlineView(facts: OfflineFacts, profile: RenderProfile): Line[] {
  const out: Line[] = [...heading("Offline mode", profile)];
  out.push(...statusBadge(facts.offline ? "info" : "inactive", facts.offline ? "Offline mode is ON: JPE makes no network requests." : "Offline mode is off: JPE may contact documentation sources when you ask it to research.", profile));
  out.push(blank(), ...keyValues([["Set by", SOURCE_WORDS[facts.source]], ["Cached documentation", `${facts.cachedDocs} ${facts.cachedDocs === 1 ? "entry" : "entries"}`]], profile));
  const network = facts.providers.filter((p) => p.needsNetwork).map((p) => p.name);
  const local = facts.providers.filter((p) => !p.needsNetwork).map((p) => p.name);
  out.push(blank(), ...heading("Documentation sources", profile));
  out.push(
    ...table(
      { columns: [{ header: "Source", min: 12 }, { header: "Needs the network", min: 8 }, { header: facts.offline ? "Now" : "Used", min: 10 }], rows: facts.providers.map((p) => [p.name, p.needsNetwork ? "yes" : "no", p.needsNetwork ? (facts.offline ? "skipped (cached copy if any)" : "yes") : "yes"]) },
      profile,
    ),
  );
  out.push(blank(), ...heading("What works offline", profile));
  out.push(...bulletList(["Explanations and local code inspection.", "Installed-package documentation (read from your project, not the network).", "Installed language servers, local tests, builds and lint.", "Review, tasks, sessions and settings.", `Documentation already cached${facts.cachedDocs === 0 ? " (nothing is cached yet)" : ""}.`], profile));
  out.push(blank(), ...heading("What does not", profile));
  out.push(...bulletList([`Fresh documentation from ${network.length === 0 ? "online sources" : network.join(", ")}.`, "Security advisories (OSV) and release notes from GitHub that are not already cached.", "`jpe doctor --deep` network probes."], profile));
  out.push(blank(), ...textLines(`Change it: \`jpe config set runtime.offline ${facts.offline ? "false" : "true"}\` (add --project for this project only). Offline mode is enforced where JPE makes its network requests, not only where it decides to; ${local.length} of ${facts.providers.length} sources never use the network.`, profile.width, { role: "muted" }));
  return out;
}

const LEVEL_MARK: Record<LogLevel, string> = { debug: "debug", info: "info", warn: "warning", error: "error" };

export function logView(entries: readonly LogEntry[], now: Date, minimum: LogLevel, configured: LogLevel, total: number, profile: RenderProfile, settingsProblem?: string): Line[] {
  const out: Line[] = [...heading("JPE event log", profile)];
  if (settingsProblem !== undefined) out.push(...statusBadge("warning", "Your settings could not be read, so default settings were used to show this.", profile), ...textLines(settingsProblem, profile.width, { role: "muted" }), blank());
  if (entries.length === 0) {
    out.push(...textLines(total === 0 ? "Nothing has been logged for this project yet. A failed or timed-out hook is recorded here, so no entry is good news." : `No entries at level ${minimum} or above. ${total} lower-level ${total === 1 ? "entry is" : "entries are"} recorded: add --level debug to see them.`, profile.width));
  } else {
    out.push(...bulletList(entries.map((e) => `${formatAge(e.at, now)} ${profile.symbols.dot} ${LEVEL_MARK[e.level]} ${profile.symbols.dot} ${inline(e.source)}: ${inline(e.message)}`), profile));
  }
  out.push(blank(), ...bulletList([`Logging level is ${configured}: entries below it are not written. Errors are always written.`, "The log holds hook failures and timeouts and session starts, with secrets removed. It never holds prompts, file contents or command output.", "Only the latest 500 entries are kept."], profile));
  return out;
}

/**
 * The settings center's knowledge of every setting: what it means, what it may be set to, what it defaults to, and which
 * layer (default, global file, project file, environment) its current value comes from.
 *
 * The list of settings, their allowed values and limits are read from the schema (`configSchema`), and the defaults from
 * `defaultConfig`, so they cannot drift. The only hand-written part is the plain-English summaries, and a test fails if a
 * setting has no summary or a summary names a setting that no longer exists.
 *
 * Pure: no file access.
 */

import { z } from "zod";
import { defaultConfig } from "./defaults.js";
import { configSchema, partialConfigSchema, type JpeConfig } from "./schema.js";

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

export const GROUP_TITLES: Readonly<Record<string, string>> = {
  explanation: "Explanations",
  docs: "Documentation",
  lsp: "Language servers",
  engineering: "Engineering",
  security: "Security",
  runtime: "Runtime",
  hooks: "Hooks",
  ui: "Interface and accessibility",
};

/** What each setting does, in plain English. */
export const SUMMARIES: Readonly<Record<string, string>> = {
  "explanation.timing": "When JPE has Claude explain a change: before it, after it, or both.",
  "explanation.depth": "How detailed explanations are. Adaptive picks brief or deep from how complex the code is.",
  "explanation.format": "Whether explanations are written as prose, as structured sections, or a mix.",
  "explanation.translateJargon": "Explain technical terms in plain English, keeping the real term in parentheses.",
  "explanation.examples": "Whether explanations include examples: always, only when useful, or never.",
  "explanation.explainChanges": "Have Claude explain what a code change does and why.",
  "explanation.explainArchitecture": "Have Claude explain how parts of the project fit together.",
  "explanation.teachConcepts": "Have Claude teach a programming concept when one comes up.",
  "docs.providers": "Where documentation is looked up, in the order tried.",
  "docs.additionalProviders": "Extra documentation sources you define, each an https address. They never hold credentials.",
  "docs.cacheTtlHours": "How many hours a downloaded documentation page is trusted before it is fetched again.",
  "docs.requestTimeoutMs": "How long, in milliseconds, to wait for a documentation source before giving up.",
  "docs.showSources": "Always show where documentation came from.",
  "lsp.autoDetect": "Find the language servers your project would use.",
  "lsp.offerInstall": "Offer to install a missing language server (never installs without your yes).",
  "lsp.continuousDiagnostics": "Check for compiler and language-server errors after each file Claude edits.",
  "lsp.diagnosticsTimeoutMs": "How long, in milliseconds, one diagnostics run may take.",
  "engineering.planning": "Whether Claude is reminded to plan before a change: adaptive, always, or never.",
  "engineering.maxRepairAttempts": "How many times /jpe:fix may try to repair a failure before stopping.",
  "engineering.commandTimeoutMs": "How long, in milliseconds, one verification command may run.",
  "engineering.backups": "Back up each file before Claude first edits it.",
  "engineering.rollback": "Allow restoring files from those backups.",
  "engineering.approval": "When JPE asks first: risk-based (destructive or sensitive actions), always (every command and edit), or off (Claude Code's own rules only).",
  "security.scanForCredentials": "Look for credential-shaped text in files Claude edits.",
  "security.treatDocsAsUntrusted": "Treat downloaded documentation as data, never as instructions.",
  "security.allowExternalUploads": "Allow JPE to send project content to an outside service. Off by default.",
  "runtime.offline": "Use only local information and cached documentation. The JPE_OFFLINE environment variable overrides it.",
  "runtime.logLevel": "How much JPE writes to its own log. The JPE_LOG_LEVEL environment variable overrides it.",
  "hooks.requireVerificationBeforeStop": "Remind Claude once per session to verify edited code before finishing.",
  "hooks.maxDiagnosticsPerSession": "The most language-server runs edits may trigger in one session.",
  "ui.theme": "The colour theme: jpe, jpe-contrast (high contrast), jpe-colorblind, or jpe-light.",
  "ui.color": "Colour depth. Auto detects your terminal; none turns colour off.",
  "ui.unicode": "Use Unicode symbols and box drawing, or plain ASCII only. Auto detects your terminal.",
  "ui.density": "How tightly screens are laid out. Auto uses compact in narrow or short terminals.",
  "ui.motion": "Animation and movement. Reduced removes it. Auto follows your system's reduced-motion hint.",
  "ui.screenReader": "Linear output with no borders or symbols, every status spelled in words. It cannot be detected, so you turn it on.",
  "ui.navigation": "Keyboard style: standard arrows, vim keys, or both.",
  "ui.shortcuts": "Your own key bindings, by action. Invalid or conflicting keys are reported and ignored.",
};

export type SettingSource = "default" | "global" | "project" | "environment";

export interface SettingInfo {
  /** `section.setting`. */
  key: string;
  section: string;
  group: string;
  summary: string;
  /** The values it may be set to, in plain words. */
  allowed: string;
  default: unknown;
}

interface JsonNode {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonNode;
  properties?: Record<string, JsonNode>;
  propertyNames?: JsonNode;
}

function describeAllowed(node: JsonNode): string {
  if (node.enum !== undefined) return node.enum.map(String).join(" | ");
  switch (node.type) {
    case "boolean":
      return "true | false";
    case "integer":
    case "number":
      return `whole number from ${node.minimum ?? "any"} to ${node.maximum ?? "any"}`;
    case "array": {
      const inner = node.items?.enum;
      return inner === undefined ? `list${node.maxItems === undefined ? "" : ` of up to ${node.maxItems}`}` : `list of: ${inner.map(String).join(", ")}`;
    }
    case "object":
      return node.propertyNames?.enum === undefined ? "a set of named values" : `set of: ${node.propertyNames.enum.map(String).join(", ")}`;
    default:
      return node.type ?? "text";
  }
}

const valueAt = (config: Plain, key: string): unknown => key.split(".").reduce<unknown>((acc, k) => (isPlain(acc) ? acc[k] : undefined), config);

/** Every setting, in schema order, with its group, summary, allowed values and default. */
export function describeSettings(): SettingInfo[] {
  const schema = z.toJSONSchema(configSchema, { io: "input" }) as unknown as JsonNode;
  const defaults = defaultConfig() as unknown as Plain;
  const out: SettingInfo[] = [];
  for (const [section, node] of Object.entries(schema.properties ?? {})) {
    if (node.properties === undefined) continue;
    for (const [name, leaf] of Object.entries(node.properties)) {
      const key = `${section}.${name}`;
      out.push({ key, section, group: GROUP_TITLES[section] ?? section, summary: SUMMARIES[key] ?? "", allowed: describeAllowed(leaf), default: valueAt(defaults, key) });
    }
  }
  return out;
}

/** The effective value of a setting. */
export const effectiveValue = (config: JpeConfig, key: string): unknown => valueAt(config as unknown as Plain, key);

/** A value as shown to a person. Strings are plain; lists are comma-separated; an empty list or set reads as "none". */
export function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  if (isPlain(value)) return Object.keys(value).length === 0 ? "none" : JSON.stringify(value);
  return typeof value === "string" ? value : JSON.stringify(value);
}

export interface Layers {
  global?: Plain | undefined;
  project?: Plain | undefined;
  environment?: Plain | undefined;
}

/** For each setting set in some layer, the highest-precedence layer that sets it (environment, then project, then global). */
export function settingSources(layers: Layers): Record<string, Exclude<SettingSource, "default">> {
  const sources: Record<string, Exclude<SettingSource, "default">> = {};
  const order: Array<[Exclude<SettingSource, "default">, Plain | undefined]> = [["global", layers.global], ["project", layers.project], ["environment", layers.environment]];
  for (const [source, layer] of order) {
    if (layer === undefined) continue;
    for (const [section, node] of Object.entries(layer)) {
      if (!isPlain(node)) continue;
      for (const name of Object.keys(node)) sources[`${section}.${name}`] = source;
    }
  }
  return sources;
}

/** Whether `key` is a real setting. */
export const isSettingKey = (key: string): boolean => describeSettings().some((s) => s.key === key);

/** Removes a setting from a config layer, dropping a section that becomes empty. The input is not changed. */
export function unsetPath(layer: Plain, key: string): Plain {
  const [section, name] = key.split(".");
  if (section === undefined || name === undefined) return { ...layer };
  const node = layer[section];
  if (!isPlain(node) || !(name in node)) return { ...layer };
  const { [name]: _removed, ...rest } = node;
  const { [section]: _section, ...others } = layer;
  return Object.keys(rest).length === 0 ? others : { ...others, [section]: rest };
}

export interface Preset {
  name: string;
  summary: string;
  /** Settings to set. */
  set: Readonly<Record<string, unknown>>;
  /** Settings to remove, returning them to their defaults. */
  unset: readonly string[];
}

const UI_APPEARANCE = ["ui.theme", "ui.color", "ui.unicode", "ui.density", "ui.motion", "ui.screenReader", "ui.navigation"] as const;

/** Ready-made accessibility and appearance choices. Each only touches `ui.*` settings. */
export const PRESETS: readonly Preset[] = [
  { name: "screen-reader", summary: "Linear text with no borders or symbols, status spelled in words, no colour and no motion.", set: { "ui.screenReader": true, "ui.color": "none", "ui.motion": "reduced" }, unset: [] },
  { name: "high-contrast", summary: "The high-contrast theme.", set: { "ui.theme": "jpe-contrast" }, unset: [] },
  { name: "colorblind", summary: "A theme that does not rely on telling red from green.", set: { "ui.theme": "jpe-colorblind" }, unset: [] },
  { name: "low-motion", summary: "No animation or movement.", set: { "ui.motion": "reduced" }, unset: [] },
  { name: "ascii", summary: "Plain ASCII characters instead of Unicode symbols and box drawing.", set: { "ui.unicode": "off" }, unset: [] },
  { name: "plain", summary: "No colour, no Unicode and no motion: for logs, old terminals and pipes.", set: { "ui.color": "none", "ui.unicode": "off", "ui.motion": "reduced" }, unset: [] },
  { name: "default", summary: "Put every appearance setting back to its default (your key bindings are kept).", set: {}, unset: UI_APPEARANCE },
];

export const findPreset = (name: string): Preset | undefined => PRESETS.find((p) => p.name === name);

/** Applies a preset to a config layer and returns the new layer. Throws nothing; check the result with `validateLayer`. */
export function applyPreset(layer: Plain, preset: Preset): Plain {
  let out: Plain = { ...layer };
  for (const key of preset.unset) out = unsetPath(out, key);
  for (const [key, value] of Object.entries(preset.set)) {
    const [section, name] = key.split(".") as [string, string];
    const node = isPlain(out[section]) ? (out[section] as Plain) : {};
    out = { ...out, [section]: { ...node, [name]: value } };
  }
  return out;
}

/** Why a config layer is not allowed, or undefined when it is. */
export function validateLayer(layer: Plain): string | undefined {
  const check = partialConfigSchema.safeParse(layer);
  if (!check.success) return check.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ");
  return undefined;
}

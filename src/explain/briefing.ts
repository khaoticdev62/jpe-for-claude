import type { JpeConfig } from "../config/schema.js";
import { analyzeCode, chooseDepth, type Analysis, type Depth } from "./analyze.js";
import type { ChangeSummary } from "./diff.js";
import { explainError } from "./errors.js";
import { findJargon, type GlossaryEntry } from "./glossary.js";

type ExplainConfig = JpeConfig["explanation"];

interface SectionSpec {
  id: string;
  title: string;
  ask: string;
}

/** The ten things every meaningful code explanation covers. */
const SECTIONS: readonly SectionSpec[] = [
  { id: "what", title: "What it does", ask: "In one or two plain sentences, what does this code do?" },
  { id: "why", title: "Why it exists", ask: "What problem does it solve, and what would be missing without it?" },
  { id: "how", title: "How it works", ask: "Walk through the logic in the order it runs, using everyday words." },
  { id: "where-used", title: "Where it is used", ask: "Which parts of the application call or rely on it?" },
  { id: "inputs", title: "What it receives", ask: "What information goes in, and what must be true about it?" },
  { id: "outputs", title: "What it produces", ask: "What comes out, including the failure cases?" },
  { id: "dependents", title: "What depends on it", ask: "Which other files would be affected if this changed?" },
  { id: "risks", title: "Mistakes and risks", ask: "What could go wrong, or trip up the next person to edit this?" },
  { id: "concepts", title: "Concepts worth knowing", ask: "Teach the programming ideas used here, each in two or three sentences." },
  { id: "examples", title: "Example", ask: "Give a small concrete example of the code in action." },
];

const REQUIRED: Record<Depth, readonly string[]> = {
  brief: ["what", "why", "how"],
  standard: ["what", "why", "how", "where-used", "inputs", "outputs", "risks"],
  deep: SECTIONS.map((s) => s.id),
};

export interface Briefing {
  depth: Depth;
  /** Section ids that must appear, in order. */
  required: string[];
  /** Section ids to include only when there is something real to say. */
  optional: string[];
  text: string;
}

function formatRules(cfg: ExplainConfig, depth: Depth): string[] {
  const rules: string[] = [];
  if (cfg.format === "hybrid") rules.push("Format: open with a two-to-three sentence plain-English summary, then use short headed sections with bullets for detail.");
  else if (cfg.format === "prose") rules.push("Format: flowing prose in short paragraphs; no tables.");
  else rules.push("Format: structured headings and bullets throughout.");
  rules.push(depth === "brief" ? "Depth: brief. This code is simple, so keep each section to one or two sentences." : depth === "standard" ? "Depth: standard. Explain each section clearly without padding." : "Depth: deep. This code is intricate, so explain step by step and slow down at the hard parts.");
  if (cfg.translateJargon) rules.push("Language: say things in everyday English first and keep the accurate technical term in parentheses. Do not oversimplify to the point of being wrong.");
  if (cfg.examples === "always") rules.push("Examples: include a concrete example in every explanation.");
  else if (cfg.examples === "when-useful") rules.push("Examples: include one only where it makes an idea clearer.");
  else rules.push("Examples: do not include examples.");
  if (!cfg.teachConcepts) rules.push("Do not add concept lessons; stay on this code.");
  return rules;
}

function glossaryBlock(entries: readonly GlossaryEntry[], cfg: ExplainConfig): string[] {
  if (!cfg.translateJargon || entries.length === 0) return [];
  return ["", "Plain-English glossary for terms in this material (use these wordings):", ...entries.slice(0, 12).map((e) => `- ${e.phrase}: ${e.plain}`)];
}

function pickSections(depth: Depth, cfg: ExplainConfig, hasDependents: boolean, hasConcepts: boolean): { required: string[]; optional: string[] } {
  const required = [...REQUIRED[depth]];
  const optional: string[] = [];
  if (cfg.examples === "always" && !required.includes("examples")) required.push("examples");
  if (cfg.examples === "never") required.splice(0, required.length, ...required.filter((s) => s !== "examples"));
  if (cfg.teachConcepts && hasConcepts && !required.includes("concepts")) (depth === "standard" ? optional : required).push("concepts");
  if (!cfg.teachConcepts) required.splice(0, required.length, ...required.filter((s) => s !== "concepts"));
  if (hasDependents && !required.includes("dependents")) optional.push("dependents");
  if (!hasDependents) required.splice(0, required.length, ...required.filter((s) => s !== "dependents"));
  const order = SECTIONS.map((s) => s.id);
  const sort = (ids: string[]): string[] => ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (cfg.examples === "when-useful" && !optional.includes("examples") && !required.includes("examples")) optional.push("examples");
  return { required: sort(required), optional: sort(optional) };
}

function sectionLines(ids: readonly string[], label: string): string[] {
  if (ids.length === 0) return [];
  return ["", `${label}:`, ...ids.map((id) => {
    const s = SECTIONS.find((x) => x.id === id);
    return `- ${s?.title}: ${s?.ask}`;
  })];
}

export interface FileBriefingInput {
  file: string;
  content: string;
  /** Files that import this one (from impact analysis). */
  dependents?: readonly string[];
  /** "before" = explaining the plan ahead of coding; "after" = explaining what was built. */
  phase?: "before" | "after";
}

function factLines(a: Analysis): string[] {
  const lines = [
    `File: ${a.file} (${a.family === "other" ? "language not specifically supported; facts below are limited" : a.family})`,
    `Size: ${a.metrics.codeLines} lines of code, ${a.metrics.functions} functions, nesting depth ${a.metrics.maxNesting}, ${a.metrics.branches} decision points, ${a.metrics.asyncMarkers} concurrency markers (complexity score ${a.metrics.score}).`,
  ];
  if (a.imports.length > 0) lines.push(`Imports: ${a.imports.slice(0, 15).join(", ")}${a.imports.length > 15 ? ", ..." : ""}`);
  if (a.symbols.length > 0) {
    lines.push("Declarations:", ...a.symbols.slice(0, 30).map((s) => `- ${s.exported ? "exported " : ""}${s.kind} ${s.name}${s.params !== undefined ? `(${s.params})` : ""} at line ${s.line}`));
  }
  if (a.risks.length > 0) {
    lines.push("Possible risks (pattern matches; verify each before stating it as a fact):", ...a.risks.slice(0, 15).map((r) => `- line ${r.line} [${r.severity}]: ${r.message}`));
  }
  return lines;
}

/** Instructions and verified-by-machine facts that Claude turns into the plain-English explanation of one file. */
export function buildFileBriefing(input: FileBriefingInput, cfg: ExplainConfig): Briefing {
  const analysis = analyzeCode(input.file, input.content);
  const depth = chooseDepth(cfg.depth, analysis.metrics);
  const { required, optional } = pickSections(depth, cfg, (input.dependents?.length ?? 0) > 0, analysis.concepts.length > 0);
  const glossary = findJargon(`${analysis.concepts.join(" ")} ${input.content.slice(0, 20_000)}`);
  const text = [
    `EXPLANATION BRIEFING (${input.phase === "before" ? "before coding: explain what is about to happen" : "after coding / existing code: explain what is there"})`,
    "Everything under FACTS was extracted mechanically by pattern matching, not a full parser. It can miss things. Read the actual code for anything you state as fact.",
    "",
    ...formatRules(cfg, depth),
    ...sectionLines(required, "Cover these sections"),
    ...sectionLines(optional, "Cover these only if there is something real to say"),
    "",
    "FACTS",
    ...factLines(analysis),
    ...(input.dependents && input.dependents.length > 0 ? [`Files that import this one: ${input.dependents.slice(0, 20).join(", ")}${input.dependents.length > 20 ? ", ..." : ""}`] : []),
    ...(analysis.concepts.length > 0 && cfg.teachConcepts ? [`Concepts present: ${analysis.concepts.join(", ")}`] : []),
    ...glossaryBlock(glossary, cfg),
  ].join("\n");
  return { depth, required, optional, text };
}

/** Briefing for explaining a change: what moved, what was added or removed, what risk patterns appeared. */
export function buildChangeBriefing(change: ChangeSummary, cfg: ExplainConfig): Briefing {
  const size = change.added + change.removed;
  const depth: Depth = cfg.depth === "adaptive" ? (size < 15 ? "brief" : size < 120 ? "standard" : "deep") : cfg.depth;
  const text = [
    "CHANGE EXPLANATION BRIEFING",
    "Facts were computed by comparing the file before and after. Read the diff itself before explaining it.",
    "",
    ...formatRules(cfg, depth),
    "",
    "Explain: what changed, why it was necessary, how the new version works, how it connects to the rest of the application, what could now go wrong, and what was tested.",
    "",
    "FACTS",
    `File: ${change.file}`,
    `Lines: +${change.added} / -${change.removed} (${change.unchanged} unchanged)${change.approximate ? " [approximate: file too large for an exact diff]" : ""}`,
    ...(change.symbolsAdded.length > 0 ? [`Added declarations: ${change.symbolsAdded.join(", ")}`] : []),
    ...(change.symbolsRemoved.length > 0 ? [`Removed declarations: ${change.symbolsRemoved.join(", ")}`] : []),
    ...(change.risksIntroduced.length > 0 ? ["New possible risks:", ...change.risksIntroduced.map((r) => `- line ${r.line} [${r.severity}]: ${r.message}`)] : []),
    ...(change.risksResolved.length > 0 ? ["Risk patterns that went away:", ...change.risksResolved.map((r) => `- ${r.id}`)] : []),
    ...change.hunks.slice(0, 8).flatMap((h) => [`Hunk at old line ${h.beforeStart} / new line ${h.afterStart}:`, ...h.removed.slice(0, 6).map((l) => `  - ${l}`), ...h.added.slice(0, 6).map((l) => `  + ${l}`)]),
  ].join("\n");
  return { depth, required: ["what", "why", "how", "risks"], optional: [], text };
}

/** Briefing for explaining an error message in plain English. */
export function buildErrorBriefing(message: string, cfg: ExplainConfig): Briefing {
  const known = explainError(message);
  const glossary = findJargon(`${message} ${known.flatMap((k) => k.terms).join(" ")}`);
  const text = [
    "ERROR EXPLANATION BRIEFING",
    ...formatRules(cfg, "standard"),
    "Explain: what the message means, the most likely causes in THIS code (read the code before guessing), and how to confirm the cause before changing anything.",
    "",
    "FACTS",
    known.length === 0 ? "No built-in explanation matched this message; reason from the message text and the code." : "Matched known patterns (general guidance, not a diagnosis of this project):",
    ...known.flatMap((k) => [`- ${k.title}`, `  Meaning: ${k.plain}`, `  Usual causes: ${k.causes}`, `  Usual fix: ${k.usualFix}`]),
    ...glossaryBlock(glossary, cfg),
  ].join("\n");
  return { depth: "standard", required: ["what", "why", "how"], optional: [], text };
}

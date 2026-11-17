import { analyzeCode, type RiskFinding } from "./analyze.js";

export interface Hunk {
  beforeStart: number;
  afterStart: number;
  removed: string[];
  added: string[];
}

export interface ChangeSummary {
  file: string;
  added: number;
  removed: number;
  unchanged: number;
  hunks: Hunk[];
  symbolsAdded: string[];
  symbolsRemoved: string[];
  risksIntroduced: RiskFinding[];
  risksResolved: RiskFinding[];
  /** True when the files were too large for an exact line diff and only counts were computed. */
  approximate: boolean;
}

const MAX_CELLS = 4_000_000;
const MAX_HUNKS = 30;

function lcsHunks(a: readonly string[], b: readonly string[]): { hunks: Hunk[]; added: number; removed: number; unchanged: number } {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const table = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? (table[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * w + j] ?? 0, table[i * w + j + 1] ?? 0);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let unchanged = 0;
  let added = 0;
  let removed = 0;
  let current: Hunk | undefined;
  const flush = (): void => {
    if (current) hunks.push(current);
    current = undefined;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      unchanged++;
      i++;
      j++;
      continue;
    }
    current ??= { beforeStart: i + 1, afterStart: j + 1, removed: [], added: [] };
    if (j < m && (i >= n || (table[i * w + j + 1] ?? 0) >= (table[(i + 1) * w + j] ?? 0))) {
      current.added.push(b[j] ?? "");
      added++;
      j++;
    } else {
      current.removed.push(a[i] ?? "");
      removed++;
      i++;
    }
  }
  flush();
  return { hunks, added, removed, unchanged };
}

const countBy = (items: readonly RiskFinding[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const r of items) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  return counts;
};

/** The lines of a text. Empty text has none, and the newline that ends a file does not start another line. */
function toLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Before-and-after facts about one file: line changes, declarations added or removed, and risk patterns gained or lost. */
export function summarizeChange(file: string, before: string, after: string): ChangeSummary {
  const a = toLines(before);
  const b = toLines(after);
  const approximate = (a.length + 1) * (b.length + 1) > MAX_CELLS;
  let stats: { hunks: Hunk[]; added: number; removed: number; unchanged: number };
  if (approximate) {
    const beforeSet = new Set(a);
    const afterSet = new Set(b);
    const added = b.filter((l) => !beforeSet.has(l)).length;
    const removed = a.filter((l) => !afterSet.has(l)).length;
    stats = { hunks: [], added, removed, unchanged: Math.max(0, b.length - added) };
  } else {
    stats = lcsHunks(a, b);
  }

  const beforeAnalysis = analyzeCode(file, before);
  const afterAnalysis = analyzeCode(file, after);
  const names = (list: typeof beforeAnalysis.symbols): Set<string> => new Set(list.map((s) => `${s.kind} ${s.name}`));
  const beforeNames = names(beforeAnalysis.symbols);
  const afterNames = names(afterAnalysis.symbols);
  const beforeRisk = countBy(beforeAnalysis.risks);
  const afterRisk = countBy(afterAnalysis.risks);

  return {
    file,
    added: stats.added,
    removed: stats.removed,
    unchanged: stats.unchanged,
    hunks: stats.hunks.slice(0, MAX_HUNKS),
    symbolsAdded: [...afterNames].filter((n) => !beforeNames.has(n)),
    symbolsRemoved: [...beforeNames].filter((n) => !afterNames.has(n)),
    risksIntroduced: afterAnalysis.risks.filter((r) => (afterRisk.get(r.id) ?? 0) > (beforeRisk.get(r.id) ?? 0)).filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i),
    risksResolved: beforeAnalysis.risks.filter((r) => (beforeRisk.get(r.id) ?? 0) > (afterRisk.get(r.id) ?? 0)).filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i),
    approximate,
  };
}

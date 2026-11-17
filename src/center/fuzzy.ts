/**
 * Fuzzy matching for the command palette: every character of the query must appear in the text, in order, and
 * matches that look intentional (a prefix, the start of a word, consecutive letters) score higher.
 * Deterministic, dependency-free, and returns the matched positions so they can be highlighted.
 */

export interface FuzzyMatch {
  score: number;
  /** Zero-based positions in the text of each matched query character. */
  indices: readonly number[];
}

const SCORE_MATCH = 1;
const SCORE_CONSECUTIVE = 2;
const SCORE_WORD_START = 3;
const SCORE_PREFIX = 5;
const PENALTY_GAP = 0.1;

const isWordStart = (text: string, index: number): boolean => index === 0 || /[\s\-_/.:]/.test(text.charAt(index - 1));

/** Matches from one fixed start position, taking the best-looking occurrence of each following character. */
function matchFrom(query: string, text: string, start: number): FuzzyMatch | undefined {
  const indices: number[] = [];
  let score = 0;
  let cursor = start;
  for (let q = 0; q < query.length; q++) {
    const char = query.charAt(q);
    // The first character is pinned to this attempt's start. Later ones prefer the next position that continues a
    // run or starts a word, and otherwise take the first occurrence.
    let found = q === 0 ? start : -1;
    for (let i = cursor; q > 0 && i < text.length; i++) {
      if (text.charAt(i) !== char) continue;
      if (found === -1) found = i;
      if (i === cursor || isWordStart(text, i)) {
        found = i;
        break;
      }
    }
    if (found === -1) return undefined;
    score += SCORE_MATCH;
    const previous = indices.at(-1);
    if (previous !== undefined && found === previous + 1) score += SCORE_CONSECUTIVE;
    else if (previous !== undefined) score -= (found - previous - 1) * PENALTY_GAP;
    if (isWordStart(text, found)) score += SCORE_WORD_START;
    indices.push(found);
    cursor = found + 1;
  }
  if (indices[0] === 0 && indices.every((position, i) => position === i)) score += SCORE_PREFIX;
  return { score, indices };
}

/**
 * The best way `query` matches `text`, or undefined when it does not. Case-insensitive. An empty query matches
 * everything with a score of 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | undefined {
  const q = query.trim().toLowerCase();
  if (q === "") return { score: 0, indices: [] };
  const t = text.toLowerCase();
  let best: FuzzyMatch | undefined;
  for (let start = t.indexOf(q.charAt(0)); start !== -1; start = t.indexOf(q.charAt(0), start + 1)) {
    const candidate = matchFrom(q, t, start);
    if (candidate !== undefined && (best === undefined || candidate.score > best.score)) best = candidate;
  }
  return best;
}

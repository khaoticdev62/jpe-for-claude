export interface ParsedMarkdown {
  front: Record<string, string>;
  body: string;
}

/** Reads the simple `key: value` front matter used by skill and agent files. Returns undefined when there is none. */
export function parseFrontmatter(text: string): ParsedMarkdown | undefined {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m?.[1]) return undefined;
  const front: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv?.[1]) front[kv[1]] = (kv[2] ?? "").replace(/^"(.*)"$/, "$1");
  }
  return { front, body: m[2] ?? "" };
}

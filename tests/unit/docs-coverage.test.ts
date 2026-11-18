import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_NAMES } from "../../src/cli/main.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The text a person can read about JPE: the README, the guides, and the skills Claude follows. */
async function documentation(): Promise<{ guides: string; all: string; files: string[] }> {
  const docs = (await readdir(path.join(ROOT, "docs"))).filter((f) => f.endsWith(".md")).map((f) => path.join("docs", f));
  const skills = (await readdir(path.join(ROOT, "skills"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => path.join("skills", d.name, "SKILL.md"));
  const files = ["README.md", ...docs, ...skills];
  const texts = await Promise.all(files.map((f) => readFile(path.join(ROOT, f), "utf8")));
  const guideIndexes = files.map((f, i) => [f, i] as const).filter(([f]) => f === "README.md" || f.startsWith("docs"));
  return { guides: guideIndexes.map(([, i]) => texts[i]).join("\n"), all: texts.join("\n"), files };
}

describe("the documentation matches the product", () => {
  it("mentions every command by name in a guide a person can read", async () => {
    const { guides } = await documentation();
    // Written as the person types it: `jpe <command>` (also after `cli.js`, which is how skills run it).
    const missing = COMMAND_NAMES.filter((name) => !new RegExp(`(jpe|cli\\.js["\`]?) +${name}\\b|/jpe:${name}\\b|\`${name}\``).test(guides));
    expect(missing, `commands with no mention in README.md or docs/: ${missing.join(", ")}`).toEqual([]);
  });

  it("links every guide from the README, so none is orphaned", async () => {
    const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
    const guides = (await readdir(path.join(ROOT, "docs"))).filter((f) => f.endsWith(".md") && f !== "IMPLEMENTATION-REPORT.md");
    const unlinked = guides.filter((f) => !readme.includes(`docs/${f}`));
    expect(unlinked, `guides the README does not link: ${unlinked.join(", ")}`).toEqual([]);
  });

  it("every relative link in the documentation points at a file that exists", async () => {
    const { files } = await documentation();
    const broken: string[] = [];
    for (const file of files.filter((f) => f.endsWith(".md") && !f.startsWith("skills"))) {
      const text = await readFile(path.join(ROOT, file), "utf8");
      for (const match of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) {
        const target = path.resolve(ROOT, path.dirname(file), match[1] ?? "");
        const exists = await readFile(target).then(() => true, () => readdir(target).then(() => true, () => false));
        if (!exists) broken.push(`${file} -> ${match[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

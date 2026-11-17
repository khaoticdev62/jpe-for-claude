// Runs the interface module's tests with Claude Code's own test runner (`claude plugin test`).
//
// The runner treats every *.test.ts and *.test.tsx file in a plugin folder as its own, which would sweep up this
// project's vitest files. So the plugin is copied to a throwaway folder first: the manifest, the hooks (including the
// built module), the types contract, and only the tests in tests/mod. The tests exercise the BUILT module
// (hooks/center.js), so run `npm run build` before this; the script refuses to run against a missing build.
//
// This needs the `claude` command line, so it is a local check, not part of the CI workflow.

import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = path.join(root, "hooks", "center.js");
try {
  await stat(built);
} catch {
  console.error("hooks/center.js is missing. Run `npm run build` first.");
  process.exit(2);
}

const work = await mkdtemp(path.join(tmpdir(), "jpe-mod-test-"));
try {
  for (const entry of [".claude-plugin", "hooks", "types"]) await cp(path.join(root, entry), path.join(work, entry), { recursive: true });
  const testsDir = path.join(root, "tests", "mod");
  for (const name of (await readdir(testsDir)).filter((n) => /\.test\.tsx?$/.test(n))) await cp(path.join(testsDir, name), path.join(work, "hooks", name));
  const result = spawnSync("claude", ["plugin", "test", work], { stdio: "inherit", shell: process.platform === "win32" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(work, { recursive: true, force: true });
}

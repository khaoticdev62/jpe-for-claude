import { writeFile } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli/bin.ts", hook: "src/hooks/bin.ts", mcp: "src/mcp/bin.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  // The bundles are ES modules. Without this marker, an installed copy (which has no package.json above it)
  // makes Node re-parse them on every start and print a warning.
  onSuccess: async () => {
    await writeFile("dist/package.json", `${JSON.stringify({ type: "module" })}
`);
  },
  sourcemap: false,
  // Hooks and the CLI run without node_modules, so bundle every dependency into the output.
  noExternal: [/.*/],
  // Bundled CommonJS dependencies call require(); give the ESM output a real one.
  banner: { js: "import { createRequire as __jpeCreateRequire } from 'node:module'; const require = __jpeCreateRequire(import.meta.url);" },
});

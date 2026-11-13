import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli/bin.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  // Hooks and the CLI run without node_modules, so bundle every dependency into the output.
  noExternal: [/.*/],
  // Bundled CommonJS dependencies call require(); give the ESM output a real one.
  banner: { js: "import { createRequire as __jpeCreateRequire } from 'node:module'; const require = __jpeCreateRequire(import.meta.url);" },
});

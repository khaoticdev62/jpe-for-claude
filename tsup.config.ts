import { writeFile } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig([
  {
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
  },
  {
    // The interface module Claude Code loads (hooks/hooks.json "modules"). It runs in the engine's sandbox: no Node, no
    // node_modules, so everything is bundled and only the engine's own `claude-code` import stays external.
    entry: { center: "src/mod/center.tsx" },
    format: ["esm"],
    target: "es2022",
    platform: "neutral",
    outDir: "hooks",
    clean: false,
    splitting: false,
    sourcemap: false,
    // Bundle everything except the engine's own module (a plain /.*/ would override `external`).
    noExternal: [/^(?!claude-code$).*/],
    external: ["claude-code"],
    outExtension: () => ({ js: ".js" }),
    esbuildOptions(options) {
      options.jsx = "transform";
      options.jsxFactory = "h";
      options.jsxFragment = "Fragment";
    },
  },
]);

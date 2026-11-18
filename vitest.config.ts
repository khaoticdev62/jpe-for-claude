import { defineConfig } from "vitest/config";

export default defineConfig({
  // The default 5 s limit is too tight for the width-by-settings matrix tests when the whole suite runs in parallel on a busy
  // machine (as `jpe verify` does), which made them fail intermittently with a timeout and no real defect. The assertions
  // are unchanged; only the time allowed is.
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
});

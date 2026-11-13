#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "runtime-failure", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > src/add.mjs <<'JS'
/** Returns the sum of two numbers. */
export function add(a, b) {
  return a - b;
}
JS
cat > test/add.test.mjs <<'JS'
import assert from "node:assert/strict";
import { test } from "node:test";
import { add } from "../src/add.mjs";

test("add() returns the sum", () => {
  assert.equal(add(1, 2), 3);
});
JS

import assert from "node:assert/strict";
import { test } from "node:test";

// A failure that existed before any change: JPE must report it as pre-existing, not "fix" it.
test("legacy currency formatting (known broken)", () => {
  assert.equal((1234.5).toFixed(1), "1,234.50");
});

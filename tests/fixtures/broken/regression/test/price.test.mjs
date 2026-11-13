import assert from "node:assert/strict";
import { test } from "node:test";
import { subtotal, withDiscount } from "../src/price.mjs";

test("subtotal multiplies price by quantity", () => {
  assert.equal(subtotal([{ price: 2, qty: 3 }, { price: 1, qty: 1 }]), 7);
});

test("withDiscount takes the percentage off", () => {
  assert.equal(withDiscount(200, 25), 150);
});

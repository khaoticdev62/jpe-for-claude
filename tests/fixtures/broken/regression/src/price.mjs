/** Total of price times quantity for each item. */
export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

/** Applies a percentage discount. */
export function withDiscount(amount, percent) {
  return amount - amount * (percent / 100);
}

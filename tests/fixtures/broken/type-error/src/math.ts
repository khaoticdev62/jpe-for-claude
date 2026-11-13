/** Adds up a list of numbers. */
export function total(items: number[]): number {
  let sum: number = "0";
  for (const item of items) sum += item;
  return sum;
}

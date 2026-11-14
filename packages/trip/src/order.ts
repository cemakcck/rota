import { generateKeyBetween } from "fractional-indexing";

/** An order key strictly between `a` and `b` (null = open end). Requires a < b. */
export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b);
}

/** Sort by order key (plain code-unit comparison), then by id so ties are stable everywhere. */
export function compareOrder(a: { order: string; id: string }, b: { order: string; id: string }): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Whether `key` is a valid fractional-indexing key (peers could write anything). */
export function isOrderKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/**
 * A key placing an item between neighbours `prev` and `next` of an already
 * sorted list. Concurrent inserts can leave neighbours with equal keys; then
 * no key fits strictly between, so the item goes just after the tied group.
 */
export function keyForSlot(sorted: readonly string[], prev: string | null, next: string | null): string {
  if (prev !== null && next !== null && prev >= next) {
    const after = sorted.find((k) => k > prev) ?? null;
    return keyBetween(prev, after);
  }
  return keyBetween(prev, next);
}

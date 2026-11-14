import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

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
 * Keys for dropping an item at position `at` of a list sorted by compareOrder.
 * Concurrent appends give equal keys, and no key fits strictly between equal
 * keys; so when the drop point splits a tied group, the tied items after it
 * get fresh keys too (`rekey`, to write in the same transaction). Each is a
 * single last-writer-wins field on one record, so nothing can duplicate.
 */
export function planSlot(
  sorted: readonly { id: string; order: string }[],
  at: number,
): { key: string; rekey: { id: string; order: string }[] } {
  const prev = sorted[at - 1]?.order ?? null;
  const next = sorted[at]?.order ?? null;
  if (prev === null || next === null || prev < next) return { key: keyBetween(prev, next), rekey: [] };
  let end = at;
  while (end < sorted.length && sorted[end].order <= prev) end++;
  const tied = sorted.slice(at, end);
  const [key, ...rest] = generateNKeysBetween(prev, sorted[end]?.order ?? null, tied.length + 1);
  return { key, rekey: tied.map((item, i) => ({ id: item.id, order: rest[i] })) };
}

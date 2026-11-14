import { describe, expect, it } from "vitest";
import { compareOrder, keyBetween } from "../src";

describe("fractional ordering", () => {
  it("keyBetween produces strictly ordered keys", () => {
    // Build a list by inserting at the end, the start and the middle, then check
    // that sorting by key reproduces the intended order.
    const list: string[] = [];
    list.push(keyBetween(null, null));
    for (let i = 0; i < 20; i++) list.push(keyBetween(list[list.length - 1], null));
    for (let i = 0; i < 20; i++) list.unshift(keyBetween(null, list[0]));
    for (let i = 0; i < 20; i++) {
      const at = 1 + ((i * 7) % (list.length - 1));
      list.splice(at, 0, keyBetween(list[at - 1], list[at]));
    }
    for (let i = 1; i < list.length; i++) expect(list[i - 1] < list[i]).toBe(true);
    expect(new Set(list).size).toBe(list.length);
    const items = list.map((order, i) => ({ order, id: `id${i}` }));
    const shuffled = [...items].reverse();
    expect(shuffled.sort(compareOrder)).toEqual(items);
  });

  it("equal order keys tie-break by id", () => {
    const a = { order: "a0", id: "aaa" };
    const b = { order: "a0", id: "bbb" };
    expect(compareOrder(a, b)).toBeLessThan(0);
    expect(compareOrder(b, a)).toBeGreaterThan(0);
    expect(compareOrder(a, { ...a })).toBe(0);
    expect(compareOrder({ order: "a0", id: "zzz" }, { order: "a1", id: "aaa" })).toBeLessThan(0);
    // Plain code-unit comparison, not locale-aware: "Z" < "a".
    expect(compareOrder({ order: "aZ", id: "x" }, { order: "aa", id: "x" })).toBeLessThan(0);
  });
});

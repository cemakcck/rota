import { describe, expect, it } from "vitest";
import { estimateLeg } from "../src";

describe("travel", () => {
  it("estimateLeg walk across the Galata Bridge is 10–20 minutes", () => {
    const leg = estimateLeg({ lat: 41.0165, lng: 28.9706 }, { lat: 41.0256, lng: 28.9744 }, "walk");
    expect(leg.approximate).toBe(true);
    expect(leg.seconds / 60).toBeGreaterThanOrEqual(10);
    expect(leg.seconds / 60).toBeLessThanOrEqual(20);
  });
  it("driving is faster than walking", () => {
    const a = { lat: 41.0, lng: 29.0 };
    const b = { lat: 41.05, lng: 29.0 };
    expect(estimateLeg(a, b, "drive").seconds).toBeLessThan(estimateLeg(a, b, "walk").seconds);
  });
});

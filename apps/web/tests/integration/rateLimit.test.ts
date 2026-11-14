import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hit } from "@/server/rateLimit";

describe("hit", () => {
  it("allows 20 then refuses the 21st", async () => {
    const key = `t:${randomUUID()}`;
    const now = new Date("2026-11-14T10:00:00Z");
    for (let i = 0; i < 20; i++) expect((await hit(key, 20, 86400, now)).ok).toBe(true);
    const refused = await hit(key, 20, 86400, now);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSec).toBeGreaterThan(0);
    expect(refused.retryAfterSec).toBeLessThanOrEqual(86400);
  });

  it("a new window resets the count", async () => {
    const key = `t:${randomUUID()}`;
    const now = new Date("2026-11-14T10:00:00Z");
    for (let i = 0; i < 21; i++) await hit(key, 20, 60, now);
    expect((await hit(key, 20, 60, now)).ok).toBe(false);
    expect((await hit(key, 20, 60, new Date(now.getTime() + 60_000))).ok).toBe(true);
  });
});

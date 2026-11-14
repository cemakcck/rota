import { afterEach, describe, expect, it, vi } from "vitest";
import { hashIp } from "@/server/ipHash";

afterEach(() => vi.unstubAllEnvs());

describe("hashIp", () => {
  it("refuses to hash without a secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IP_HASH_SECRET", "");
    expect(() => hashIp("1.2.3.4")).toThrow(/IP_HASH_SECRET/);
  });
  it("hashes with the secret, differently per secret", () => {
    expect(hashIp("1.2.3.4", "a")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp("1.2.3.4", "a")).not.toBe(hashIp("1.2.3.4", "b"));
  });
});

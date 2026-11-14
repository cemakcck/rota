import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, hashIp, trustedProxyHops } from "@/server/ipHash";

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

describe("clientIp", () => {
  const req = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });

  it("takes the entry the last trusted proxy appended, not the client-supplied ones", () => {
    expect(clientIp(req("6.6.6.6, 1.2.3.4"), 1)).toBe("1.2.3.4");
    expect(clientIp(req("6.6.6.6, 1.2.3.4, 10.0.0.1"), 2)).toBe("1.2.3.4");
    expect(clientIp(req("1.2.3.4"), 1)).toBe("1.2.3.4");
  });
  it("uses the first entry when there are fewer entries than hops", () => {
    expect(clientIp(req("1.2.3.4"), 3)).toBe("1.2.3.4");
  });
  it("ignores the header with zero hops, and falls back without one", () => {
    expect(clientIp(req("6.6.6.6"), 0)).toBe("unknown");
    expect(clientIp(req(), 1)).toBe("unknown");
    expect(clientIp(req(" , "), 1)).toBe("unknown");
  });
  it("reads TRUSTED_PROXY_HOPS, defaulting to one hop", () => {
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops("")).toBe(1);
    expect(trustedProxyHops("2")).toBe(2);
    expect(trustedProxyHops("0")).toBe(0);
    expect(trustedProxyHops("nope")).toBe(1);
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIp(req("6.6.6.6, 1.2.3.4, 10.0.0.1"))).toBe("1.2.3.4");
  });
});

import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Keyed hash of an IP so rate limiting works without ever storing a raw IP. */
export function hashIp(ip: string, secret: string | undefined = process.env.IP_HASH_SECRET): string {
  if (!secret) {
    // A public fallback key would make hashed IPv4 addresses trivially reversible.
    if (process.env.NODE_ENV === "production") throw new Error("IP_HASH_SECRET must be set in production");
    secret = "dev-secret";
  }
  return createHmac("sha256", secret).update(ip).digest("hex");
}

/** Headers of a Fetch `Request`, a `Headers`, or a Node `IncomingMessage`, as one `Headers`. */
export function toHeaders(source: Request | Headers | IncomingMessage): Headers {
  if (source instanceof Headers) return source;
  if (source instanceof Request) return source.headers;
  const headers = new Headers();
  for (const [name, value] of Object.entries(source.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/**
 * How many proxies in front of the app append to X-Forwarded-For (`TRUSTED_PROXY_HOPS`, default 1).
 * Each trusted proxy appends the address it received the request from, so the client's address is the
 * entry that many places from the end; everything before it was sent by the client and can be forged.
 * Railway's edge is one hop: its staff say it overwrites X-Forwarded-For, users report it appends, and
 * the last entry is the client in both cases. 0 ignores the header (no proxy: use the socket address).
 */
export function trustedProxyHops(value: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  if (!value?.trim()) return 1;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : 1;
}

/** The visitor's IP: the X-Forwarded-For entry the trusted proxies put there, else the socket address. */
export function clientIp(req: Request | Headers | IncomingMessage, hops: number = trustedProxyHops()): string {
  const header = toHeaders(req).get("x-forwarded-for");
  if (header && hops > 0) {
    const entries = header.split(",").map((e) => e.trim()).filter(Boolean);
    // Fewer entries than hops: the request reached us through fewer proxies than configured, so the
    // first entry is the nearest one we have.
    const forwarded = entries[Math.max(0, entries.length - hops)];
    if (forwarded) return forwarded;
  }
  if (!(req instanceof Request) && !(req instanceof Headers) && req.socket?.remoteAddress) return req.socket.remoteAddress;
  return "unknown";
}

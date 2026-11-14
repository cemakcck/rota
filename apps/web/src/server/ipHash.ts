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
 * The visitor's IP: the first `x-forwarded-for` entry, else the socket address. X-Forwarded-For is
 * client-controlled unless a trusted reverse proxy overwrites it, so production must run behind one.
 */
export function clientIp(req: Request | Headers | IncomingMessage): string {
  const forwarded = toHeaders(req).get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  if (!(req instanceof Request) && !(req instanceof Headers) && req.socket?.remoteAddress) return req.socket.remoteAddress;
  return "unknown";
}

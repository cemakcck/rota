import { HttpError } from "../httpError";
import { hit } from "../rateLimit";
import { clientIp, hashIp } from "../ipHash";

export const USER_AGENT = "Tripify portfolio demo (https://github.com/cemakcck/tripify)";

/** Free public services ask for at most one request per second. */
const SPACING_MS = 1000;
/** A request that would queue longer than this fails at once instead. */
const MAX_WAIT_MS = 2000;
const TIMEOUT_MS = 5000;

/** The service is unavailable: busy (our queue is full), slow, down or answering with an error. */
export class UpstreamUnavailable extends Error {}
/** Too many of our own requests are already queued for the service. */
export class UpstreamBusy extends UpstreamUnavailable {}

// When each service may next be called, and the requests on their way (shared by identical calls).
const nextSlot = new Map<string, number>();
const inflight = new Map<string, Promise<unknown>>();

/** Forgets every queue; for tests, so one test's requests do not delay the next's. */
export function resetThrottles(): void {
  nextSlot.clear();
}

/**
 * Fetches JSON from a public service: at most one request per second per service (later ones wait
 * their turn, unless that would take over 2 s), a 5 s timeout, and our User-Agent. A request for a URL
 * already on its way shares that answer instead of taking another turn.
 */
export function throttled(service: string) {
  return function get<T>(url: string): Promise<T> {
    let request = inflight.get(url) as Promise<T> | undefined;
    if (!request) {
      request = fetchJson<T>(service, url).finally(() => inflight.delete(url));
      inflight.set(url, request);
    }
    return request;
  };
}

async function fetchJson<T>(service: string, url: string): Promise<T> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(service) ?? 0);
  if (slot - now > MAX_WAIT_MS) throw new UpstreamBusy(service);
  nextSlot.set(service, slot + SPACING_MS);
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new UpstreamUnavailable(`${service}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new UpstreamUnavailable(`${service}: ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new UpstreamUnavailable(`${service}: not JSON`);
  }
}

/** Counts a request against the caller's per-minute limit for `name`; over it is a 429. */
export async function limitPerMinute(req: Request, name: string, limit: number): Promise<void> {
  const { ok } = await hit(`${name}:${hashIp(clientIp(req))}`, limit, 60);
  if (!ok) throw new HttpError(429, "rate_limited");
}

/** Runs a proxy call; an unavailable service is a 503 the client falls back from. */
export async function orUnavailable<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof UpstreamUnavailable) throw new HttpError(503, "upstream_unavailable");
    throw err;
  }
}

/** The query string of a request as an object, for a zod schema. */
export const queryOf = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

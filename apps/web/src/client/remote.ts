import { useEffect, useSyncExternalStore } from "react";

/** After a failure, a key is asked for again no sooner than this (sooner when the connection returns). */
const RETRY_MS = 60_000;
/** A request with no answer by then (a stalled connection) is aborted and counts as a failure. */
const LOAD_TIMEOUT_MS = 10_000;

/** Our API refused the request itself (a 4xx other than 429): asking again would get the same answer. */
export class RequestRefused extends Error {
  constructor(readonly status: number) {
    super(`refused: ${status}`);
  }
}

type Entry<T> = { value: T } | { pending: true } | { failedAt: number } | { refused: true };

/**
 * A client-side cache of answers from one of our proxy routes, shared by every component on the page.
 * `load` fetches a batch of keys (at most `batch`) and resolves to the value of each. Batches go one
 * at a time, so a page asking for many keys at once does not burst past the service's one request a
 * second (the proxy turns a burst away). Failures (offline, a 503) are not shown to anyone: callers
 * keep their fallback, and the key is asked for again later (see useRemote), unless our API refused it
 * (RequestRefused), which is final. A request unanswered after 10 s is aborted and counts as failed, so a
 * stalled connection cannot hold up the queue.
 */
export function createRemote<T>(load: (keys: string[], signal: AbortSignal) => Promise<Map<string, T>>, batch = 1) {
  const entries = new Map<string, Entry<T>>();
  const listeners = new Set<() => void>();
  const queue: string[][] = [];
  let busy = false;
  let version = 0;

  function next(): void {
    const chunk = queue.shift();
    if (!chunk) return void (busy = false);
    busy = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timed out"));
      }, LOAD_TIMEOUT_MS);
    });
    Promise.race([load(chunk, controller.signal), timeout])
      .then(
        (values) => {
          for (const key of chunk) {
            const value = values.get(key);
            entries.set(key, value === undefined ? { failedAt: Date.now() } : { value });
          }
          version++;
          listeners.forEach((l) => l());
        },
        (err) => {
          for (const key of chunk) entries.set(key, err instanceof RequestRefused ? { refused: true } : { failedAt: Date.now() });
          // No value, but no longer pending: readers stop waiting for one.
          version++;
          listeners.forEach((l) => l());
        },
      )
      .finally(() => {
        clearTimeout(timer);
        next();
      });
  }

  /** Queues the keys not known yet; failed keys too once they are due, or at once with `retryFailed`. */
  function request(keys: string[], retryFailed = false): void {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const wanted = [...new Set(keys)].filter((key) => {
      const entry = entries.get(key);
      return !entry || ("failedAt" in entry && (retryFailed || Date.now() - entry.failedAt >= RETRY_MS));
    });
    for (let i = 0; i < wanted.length; i += batch) {
      const chunk = wanted.slice(i, i + batch);
      for (const key of chunk) entries.set(key, { pending: true });
      queue.push(chunk);
    }
    if (!busy) next();
  }

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      return entry && "value" in entry ? entry.value : undefined;
    },
    /** True while the key is asked for, or not asked for yet while online (an answer may still come). */
    pending(key: string): boolean {
      const entry = entries.get(key);
      if (!entry) return typeof navigator === "undefined" || navigator.onLine;
      return "pending" in entry;
    },
    request,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    version: () => version,
  };
}

export type Remote<T> = ReturnType<typeof createRemote<T>>;

/**
 * Asks for `keys` when they change, again every minute for those that failed, and at once when the
 * connection returns; re-renders as answers arrive. Returns the cache's reader and its version, which
 * changes whenever an answer arrives (for memo dependencies).
 */
export function useRemote<T>(
  remote: Remote<T>,
  keys: string[],
): { get: (key: string) => T | undefined; pending: (key: string) => boolean; version: number } {
  const version = useSyncExternalStore(remote.subscribe, remote.version, remote.version);
  const joined = keys.join("\n");
  useEffect(() => {
    if (!joined) return;
    const list = joined.split("\n");
    remote.request(list);
    const retry = setInterval(() => remote.request(list), RETRY_MS);
    const online = () => remote.request(list, true);
    window.addEventListener("online", online);
    return () => {
      clearInterval(retry);
      window.removeEventListener("online", online);
    };
  }, [remote, joined]);
  return { get: remote.get, pending: remote.pending, version };
}

/**
 * GETs one of our API routes as JSON. A 4xx other than 429 is a RequestRefused (final); anything else
 * that is not a 200 is a failure worth retrying.
 */
export async function getJson<T>(path: string, fetcher: (path: string, init?: RequestInit) => Promise<Response>, signal?: AbortSignal): Promise<T> {
  const res = await fetcher(path, { signal });
  if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new RequestRefused(res.status);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

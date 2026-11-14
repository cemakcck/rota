import { useEffect, useSyncExternalStore } from "react";

/** After a failure, a key is asked for again no sooner than this. */
const RETRY_MS = 60_000;

type Entry<T> = { value: T } | { pending: true } | { failedAt: number };

/**
 * A client-side cache of answers from one of our proxy routes, shared by every component on the page.
 * `load` fetches a batch of keys (at most `batch`) and resolves to the value of each. Failures (offline,
 * a 503) are not shown to anyone: callers keep their fallback, and the key is retried a minute later.
 */
export function createRemote<T>(load: (keys: string[]) => Promise<Map<string, T>>, batch = 1) {
  const entries = new Map<string, Entry<T>>();
  const listeners = new Set<() => void>();
  let version = 0;

  function request(keys: string[]): void {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const wanted = [...new Set(keys)].filter((key) => {
      const entry = entries.get(key);
      return !entry || ("failedAt" in entry && Date.now() - entry.failedAt > RETRY_MS);
    });
    for (let i = 0; i < wanted.length; i += batch) {
      const chunk = wanted.slice(i, i + batch);
      for (const key of chunk) entries.set(key, { pending: true });
      load(chunk).then(
        (values) => {
          for (const key of chunk) {
            const value = values.get(key);
            entries.set(key, value === undefined ? { failedAt: Date.now() } : { value });
          }
          version++;
          listeners.forEach((l) => l());
        },
        () => {
          for (const key of chunk) entries.set(key, { failedAt: Date.now() });
        },
      );
    }
  }

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      return entry && "value" in entry ? entry.value : undefined;
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
 * Asks for `keys` (when they change) and re-renders as answers arrive. Returns the cache's reader and
 * its version, which changes whenever an answer arrives (for memo dependencies).
 */
export function useRemote<T>(remote: Remote<T>, keys: string[]): { get: (key: string) => T | undefined; version: number } {
  const version = useSyncExternalStore(remote.subscribe, remote.version, remote.version);
  const joined = keys.join("\n");
  useEffect(() => {
    if (joined) remote.request(joined.split("\n"));
  }, [remote, joined]);
  return { get: remote.get, version };
}

/** GETs one of our API routes as JSON; anything but a 200 is a failure. */
export async function getJson<T>(path: string, fetcher: (path: string) => Promise<Response>): Promise<T> {
  const res = await fetcher(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

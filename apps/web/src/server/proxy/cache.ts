/**
 * A small in-memory LRU cache with a time to live. One per process: the app runs as a single
 * replica, so there is nothing to share it with.
 */
export function createCache<T>(max: number, ttlMs: number) {
  const entries = new Map<string, { value: T; expires: number }>();
  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expires <= Date.now()) return undefined;
      // Re-inserted, so the Map's order stays least recently used first.
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T): void {
      entries.delete(key);
      entries.set(key, { value, expires: Date.now() + ttlMs });
      while (entries.size > max) entries.delete(entries.keys().next().value!);
    },
  };
}

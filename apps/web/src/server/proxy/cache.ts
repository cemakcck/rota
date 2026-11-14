/**
 * A small in-memory LRU cache with a time to live, capped by entry count and optionally by total size
 * (`sizeOf` estimates a value's bytes). One per process: the app runs as a single replica, so there is
 * nothing to share it with.
 */
export function createCache<T>(max: number, ttlMs: number, { maxBytes = Infinity, sizeOf = () => 0 }: { maxBytes?: number; sizeOf?: (value: T) => number } = {}) {
  const entries = new Map<string, { value: T; expires: number; bytes: number }>();
  let bytes = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    bytes -= entry.bytes;
  };
  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expires <= Date.now()) {
        bytes -= entry.bytes;
        return undefined;
      }
      // Re-inserted, so the Map's order stays least recently used first.
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T): void {
      remove(key);
      const size = sizeOf(value);
      if (size > maxBytes) return;
      entries.set(key, { value, expires: Date.now() + ttlMs, bytes: size });
      bytes += size;
      while (entries.size > max || bytes > maxBytes) remove(entries.keys().next().value!);
    },
  };
}

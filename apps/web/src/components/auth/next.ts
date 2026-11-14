const BASE = "http://x";

/** A return path from the query, only if it stays inside this app (no other origins, no `//host`, no control characters). */
export function safeNext(value: string | undefined | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || /[\u0000- \u007f\\]/.test(value)) return "/trips";
  try {
    // URL parsing strips tabs and newlines, so check where the path really resolves.
    if (new URL(value, BASE).origin !== BASE) return "/trips";
  } catch {
    return "/trips";
  }
  return value;
}

/** A return path from the query, only if it stays inside this app (no other origins, no `//host`). */
export function safeNext(value: string | undefined | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/trips";
  return value;
}

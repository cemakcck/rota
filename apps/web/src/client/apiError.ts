/** The `error` code of a failed API response ("generic" when it has none). */
export async function readError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string") return (body as { error: string }).error;
  } catch {
    // Not JSON.
  }
  return "generic";
}

/** The translation of an API error code from the `errors` namespace, else the generic message. */
export function errorMessage(t: { (key: string): string; has: (key: string) => boolean }, code: string): string {
  return t.has(code) ? t(code) : t("generic");
}

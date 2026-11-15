/**
 * Whether the demo's per-IP daily start limit applies. Local development can turn it off with
 * DEMO_RATE_LIMIT=off (every local start shares one IP); production always enforces it.
 */
export function demoLimitApplies(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" || env.DEMO_RATE_LIMIT !== "off";
}

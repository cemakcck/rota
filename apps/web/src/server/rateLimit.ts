import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { rateLimits } from "./db/schema";

/**
 * Fixed-window counter in one upsert-returning statement. `now` is injectable so tests can step
 * into the next window without waiting. Windows are at most a day long: the hourly cleanup drops
 * rows whose window started more than a day ago.
 */
export async function hit(
  key: string,
  limit: number,
  windowSec: number,
  now: Date = new Date(),
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const windowMs = windowSec * 1000;
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: new Date(start), count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  return {
    ok: row.count <= limit,
    retryAfterSec: Math.max(1, Math.ceil((start + windowMs - now.getTime()) / 1000)),
  };
}

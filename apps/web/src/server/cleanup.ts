import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "./db/client";
import { tripTombstones, trips, user } from "./db/schema";
import { deleteTrip } from "./trips/repo";

const DEMO_IDLE_DAYS = 7;
const TOMBSTONE_DAYS = 30;

/** Deletes demo accounts idle for 7 days (their trips tombstoned first) and tombstones past 30 days. */
async function cleanUp(): Promise<void> {
  const idle = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.isDemo, true),
        lt(sql`coalesce(${user.lastActiveAt}, ${user.createdAt})`, sql`now() - make_interval(days => ${DEMO_IDLE_DAYS})`),
      ),
    );
  for (const { id } of idle) {
    // Trips do not cascade from their owner; deleteTrip also tells connected members "deleted".
    const owned = await db.select({ id: trips.id }).from(trips).where(eq(trips.ownerId, id));
    for (const trip of owned) await deleteTrip(trip.id);
    await db.delete(user).where(eq(user.id, id));
  }
  await db.delete(tripTombstones).where(lt(tripTombstones.deletedAt, sql`now() - make_interval(days => ${TOMBSTONE_DAYS})`));
}

/** Runs housekeeping every `intervalMs`. Failures are logged and the next run tries again. Returns a stop function. */
export function startCleanup(intervalMs = 3_600_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    cleanUp()
      .catch((err) => console.error("[cleanup] failed", err))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

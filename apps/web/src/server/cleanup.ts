import { and, eq, inArray, like, lt, notExists, notLike, sql } from "drizzle-orm";
import { db } from "./db/client";
import { DEMO_FRIEND_DOMAIN } from "./demo";
import { tripMembers, tripTombstones, trips, user } from "./db/schema";
import { deleteTrip } from "./trips/repo";

const DEMO_IDLE_DAYS = 7;
const TOMBSTONE_DAYS = 30;

/**
 * Deletes demo visitors idle for 7 days (their trips tombstoned first) together with the demo
 * friends on those trips, and tombstones past 30 days. Friends never act, so their own activity
 * says nothing: their lifetime follows the visitor's.
 */
async function cleanUp(): Promise<void> {
  const idle = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.isDemo, true),
        notLike(user.email, `%@${DEMO_FRIEND_DOMAIN}`),
        lt(sql`coalesce(${user.lastActiveAt}, ${user.createdAt})`, sql`now() - make_interval(days => ${DEMO_IDLE_DAYS})`),
      ),
    );
  for (const { id } of idle) {
    // Trips do not cascade from their owner; deleteTrip also tells connected members "deleted".
    const owned = await db.select({ id: trips.id }).from(trips).where(eq(trips.ownerId, id));
    const friends = owned.length
      ? await db
          .select({ id: user.id })
          .from(tripMembers)
          .innerJoin(user, eq(user.id, tripMembers.userId))
          .where(and(inArray(tripMembers.tripId, owned.map((t) => t.id)), eq(user.isDemo, true), like(user.email, `%@${DEMO_FRIEND_DOMAIN}`)))
      : [];
    for (const trip of owned) await deleteTrip(trip.id);
    if (friends.length) await db.delete(user).where(inArray(user.id, friends.map((f) => f.id)));
    await db.delete(user).where(eq(user.id, id));
  }
  // Safety net: friends in no trip (a failed start, or a crash between deleting a trip and its friends).
  // The week's grace keeps a start that is still in flight safe.
  await db.delete(user).where(
    and(
      eq(user.isDemo, true),
      like(user.email, `%@${DEMO_FRIEND_DOMAIN}`),
      lt(user.createdAt, sql`now() - make_interval(days => ${DEMO_IDLE_DAYS})`),
      notExists(db.select({ one: sql`1` }).from(tripMembers).where(eq(tripMembers.userId, user.id))),
    ),
  );
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

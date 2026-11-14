import { and, eq, inArray, isNull, like, lt, ne, notExists, notLike, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./db/client";
import { DEMO_FRIEND_DOMAIN } from "./demo";
import { rateLimits, tripMembers, tripTombstones, trips, user } from "./db/schema";
import { deleteTrip } from "./trips/repo";

const DEMO_IDLE_DAYS = 7;
const TOMBSTONE_DAYS = 30;

/**
 * The visitor's demo trips: the ones they own, and the ones they handed to a demo friend (Deniz or
 * Selin) where no other real person is left. Those trips go (tombstoned, members told), then the
 * friends on them, then the visitor.
 */
async function deleteDemoVisitor(id: string): Promise<void> {
  const friendEmail = `%@${DEMO_FRIEND_DOMAIN}`;
  const owner = alias(user, "owner");
  const visitor = alias(tripMembers, "visitor");
  const other = alias(tripMembers, "other");
  const otherUser = alias(user, "other_user");
  const owned = await db.select({ id: trips.id }).from(trips).where(eq(trips.ownerId, id));
  const handedOver = await db
    .select({ id: trips.id })
    .from(trips)
    .innerJoin(visitor, and(eq(visitor.tripId, trips.id), eq(visitor.userId, id)))
    .innerJoin(owner, eq(owner.id, trips.ownerId))
    .where(
      and(
        eq(trips.isDemo, true),
        like(owner.email, friendEmail),
        notExists(
          db
            .select({ one: sql`1` })
            .from(other)
            .innerJoin(otherUser, eq(otherUser.id, other.userId))
            .where(and(eq(other.tripId, trips.id), ne(other.userId, id), isNull(other.removedAt), notLike(otherUser.email, friendEmail))),
        ),
      ),
    );
  const tripIds = [...owned, ...handedOver].map((t) => t.id);
  // Trips do not cascade from their owner; deleteTrip also tells connected members "deleted".
  const friends = tripIds.length
    ? await db
        .select({ id: user.id })
        .from(tripMembers)
        .innerJoin(user, eq(user.id, tripMembers.userId))
        .where(and(inArray(tripMembers.tripId, tripIds), eq(user.isDemo, true), like(user.email, friendEmail)))
    : [];
  for (const tripId of tripIds) await deleteTrip(tripId);
  if (friends.length) await db.delete(user).where(inArray(user.id, friends.map((f) => f.id)));
  await db.delete(user).where(eq(user.id, id));
}

/**
 * Deletes demo visitors idle for 7 days (their trips tombstoned first) together with the demo
 * friends on those trips, and tombstones past 30 days. Friends never act, so their own activity
 * says nothing: their lifetime follows the visitor's. Also drops rate-limit windows past a day.
 */
export async function cleanUp(): Promise<void> {
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
    try {
      await deleteDemoVisitor(id);
    } catch (err) {
      // One stuck user must not keep every later one around: the next run tries it again.
      console.error("[cleanup] could not delete demo user", id, err);
    }
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
  // The longest rate-limit window is a day, so a window that started over a day ago has ended.
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`));
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

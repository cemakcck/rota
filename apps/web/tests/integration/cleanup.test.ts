import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newTripId } from "@rota/trip";
import { startCleanup } from "@/server/cleanup";
import { db } from "@/server/db/client";
import { tripTombstones, trips, user } from "@/server/db/schema";
import { createTrip } from "@/server/trips/repo";
import { NEW_TRIP, insertUser } from "./helpers";

const DAY = 86_400_000;

async function demoUser(lastActive: Date): Promise<{ id: string; tripId: string }> {
  const id = await insertUser("Demo");
  await db.update(user).set({ isDemo: true, lastActiveAt: lastActive }).where(eq(user.id, id));
  const tripId = await createTrip({ ownerId: id, ...NEW_TRIP, destination: null, isDemo: true });
  return { id, tripId };
}

const userExists = async (id: string) => (await db.select({ id: user.id }).from(user).where(eq(user.id, id))).length > 0;
const tripExists = async (id: string) => (await db.select({ id: trips.id }).from(trips).where(eq(trips.id, id))).length > 0;
const tombstones = async (ids: string[]) =>
  (await db.select({ id: tripTombstones.tripId }).from(tripTombstones).where(inArray(tripTombstones.tripId, ids))).map((t) => t.id);

describe("cleanup", () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
  });

  it("demo users idle 7 days are deleted with their trips; active ones stay", async () => {
    const idle = await demoUser(new Date(Date.now() - 8 * DAY));
    const active = await demoUser(new Date(Date.now() - 6 * DAY));
    const realIdle = await insertUser("Real"); // not a demo account: never cleaned up
    await db.update(user).set({ lastActiveAt: new Date(Date.now() - 90 * DAY) }).where(eq(user.id, realIdle));
    const oldStone = newTripId();
    const freshStone = newTripId();
    await db.insert(tripTombstones).values([
      { tripId: oldStone, deletedAt: new Date(Date.now() - 31 * DAY) },
      { tripId: freshStone, deletedAt: new Date(Date.now() - 29 * DAY) },
    ]);

    stop = startCleanup(20);
    await vi.waitFor(async () => expect(await userExists(idle.id)).toBe(false), { timeout: 5000 });

    expect(await tripExists(idle.tripId)).toBe(false);
    expect(await userExists(active.id)).toBe(true);
    expect(await tripExists(active.tripId)).toBe(true);
    expect(await userExists(realIdle)).toBe(true);
    // The deleted trip is tombstoned (members are told "deleted"); tombstones past 30 days go.
    await vi.waitFor(async () => expect((await tombstones([idle.tripId, oldStone, freshStone])).sort()).toEqual([idle.tripId, freshStone].sort()));
  });

  it("cleanup survives a DB error", async () => {
    const idle = await demoUser(new Date(Date.now() - 8 * DAY));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("database unreachable");
    });

    stop = startCleanup(20);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith("[cleanup] failed", expect.any(Error)));
    // The timer keeps going: the next run succeeds.
    await vi.waitFor(async () => expect(await userExists(idle.id)).toBe(false), { timeout: 5000 });
  });
});

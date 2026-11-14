import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newTripId } from "@rota/trip";
import { cleanUp, startCleanup } from "@/server/cleanup";
import { db } from "@/server/db/client";
import { DEMO_FRIEND_DOMAIN } from "@/server/demo";
import { rateLimits, tripInvites, tripMembers, tripTombstones, trips, user } from "@/server/db/schema";
import { createLinkInvite } from "@/server/trips/invites";
import { addMember, createTrip, transferOwnership } from "@/server/trips/repo";
import { NEW_TRIP, insertUser } from "./helpers";

const DAY = 86_400_000;

async function demoUser(lastActive: Date): Promise<{ id: string; tripId: string }> {
  const id = await insertUser("Demo");
  await db.update(user).set({ isDemo: true, lastActiveAt: lastActive }).where(eq(user.id, id));
  const tripId = await createTrip({ ownerId: id, ...NEW_TRIP, destination: null, isDemo: true });
  return { id, tripId };
}

/** A demo friend (Deniz/Selin style): never acts, so its own lastActiveAt is old from day one. */
async function demoFriend(tripId: string): Promise<string> {
  const id = await insertUser("Deniz");
  await db.update(user).set({ isDemo: true, email: `${id}@${DEMO_FRIEND_DOMAIN}` }).where(eq(user.id, id));
  await addMember(tripId, id, "member");
  return id;
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

  it("demo friends live and die with the visitor whose trip they are on, never on their own", async () => {
    // Friends are old (never act); the visitor is still active, so everyone stays.
    const active = await demoUser(new Date(Date.now() - 1 * DAY));
    const friend = await demoFriend(active.tripId);
    await db.update(user).set({ createdAt: new Date(Date.now() - 30 * DAY), lastActiveAt: new Date(Date.now() - 30 * DAY) }).where(eq(user.id, friend));
    // An idle visitor goes together with their friends.
    const idle = await demoUser(new Date(Date.now() - 8 * DAY));
    const idleFriend = await demoFriend(idle.tripId);
    // A friend of someone else's trip is not collateral.
    const bystander = await insertUser("Bystander");
    await db.update(user).set({ isDemo: true }).where(eq(user.id, bystander));
    await addMember(idle.tripId, bystander, "member");

    stop = startCleanup(20);
    await vi.waitFor(async () => expect(await userExists(idle.id)).toBe(false), { timeout: 5000 });

    expect(await userExists(idleFriend)).toBe(false);
    expect(await tripExists(idle.tripId)).toBe(false);
    expect(await userExists(friend)).toBe(true);
    expect(await userExists(active.id)).toBe(true);
    expect((await db.select().from(tripMembers).where(eq(tripMembers.userId, friend))).length).toBe(1);
    expect(await userExists(bystander)).toBe(true);
  });

  it("sweeps orphaned demo friends (in no live trip) once a week old; younger ones and members of live trips stay", async () => {
    const orphan = async (ageDays: number) => {
      const id = await insertUser("Selin");
      await db
        .update(user)
        .set({ isDemo: true, email: `${id}@${DEMO_FRIEND_DOMAIN}`, createdAt: new Date(Date.now() - ageDays * DAY) })
        .where(eq(user.id, id));
      return id;
    };
    const old = await orphan(8);
    const fresh = await orphan(1); // a start may still be in flight
    const housed = await demoUser(new Date());
    const housedFriend = await demoFriend(housed.tripId);
    await db.update(user).set({ createdAt: new Date(Date.now() - 30 * DAY) }).where(eq(user.id, housedFriend));

    stop = startCleanup(20);
    await vi.waitFor(async () => expect(await userExists(old)).toBe(false), { timeout: 5000 });
    expect(await userExists(fresh)).toBe(true);
    expect(await userExists(housedFriend)).toBe(true);
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

  it("a visitor who made an invite link and handed the trip to a demo friend is still deleted, with the trip and friends", async () => {
    const idle = await demoUser(new Date(Date.now() - 8 * DAY));
    const deniz = await demoFriend(idle.tripId);
    const selin = await demoFriend(idle.tripId);
    await createLinkInvite(idle.tripId, idle.id);
    await transferOwnership(idle.tripId, deniz);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await cleanUp();
    expect(await userExists(idle.id)).toBe(false);
    expect(await tripExists(idle.tripId)).toBe(false);
    expect(await userExists(deniz)).toBe(false);
    expect(await userExists(selin)).toBe(false);
  });

  it("an invite outlives the user who made it", async () => {
    const owner = await insertUser("Owner");
    const maker = await insertUser("Maker");
    const tripId = await createTrip({ ownerId: owner, ...NEW_TRIP, destination: null, isDemo: false });
    await createLinkInvite(tripId, maker);
    await db.delete(user).where(eq(user.id, maker));
    const [invite] = await db.select().from(tripInvites).where(eq(tripInvites.tripId, tripId));
    expect(invite.createdBy).toBeNull();
  });

  it("one demo user that cannot be deleted does not stop the others", async () => {
    const first = await demoUser(new Date(Date.now() - 8 * DAY));
    const second = await demoUser(new Date(Date.now() - 8 * DAY));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "delete").mockImplementationOnce(() => {
      throw new Error("cannot delete this one");
    });

    await expect(cleanUp()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith("[cleanup] could not delete demo user", expect.any(String), expect.any(Error));
    // Exactly one run happened: whichever user hit the error stays, everyone after it went.
    const left = [await userExists(first.id), await userExists(second.id)].filter(Boolean);
    expect(left.length).toBeLessThanOrEqual(1);
  });

  it("a trip handed to a demo friend stays while another real person is still on it", async () => {
    const idle = await demoUser(new Date(Date.now() - 8 * DAY));
    const deniz = await demoFriend(idle.tripId);
    const joined = await insertUser("Joined");
    await addMember(idle.tripId, joined, "member");
    await transferOwnership(idle.tripId, deniz);

    await cleanUp();
    expect(await userExists(idle.id)).toBe(false);
    expect(await tripExists(idle.tripId)).toBe(true);
    expect(await userExists(joined)).toBe(true);
  });

  it("prunes rate-limit windows older than a day", async () => {
    const key = `prune:${newTripId()}`;
    const HOUR = 3_600_000;
    await db.insert(rateLimits).values([
      { key, windowStart: new Date(Date.now() - 25 * HOUR), count: 3 },
      { key, windowStart: new Date(Date.now() - 23 * HOUR), count: 1 },
    ]);
    await cleanUp();
    const left = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
    expect(left.map((r) => r.count)).toEqual([1]);
  });
});

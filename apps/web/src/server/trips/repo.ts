import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import * as Y from "yjs";
import {
  addDay,
  initTrip,
  readTrip,
  removeDay,
  removeMember as removeDocMember,
  newTripId,
  setTripMeta,
  upsertMember,
  type Destination,
  type Locale,
} from "@rota/trip";
import { db, type Db } from "../db/client";
import { tripDocuments, tripMembers, tripTombstones, trips, user } from "../db/schema";
import { HttpError } from "../httpError";
import { applyServerChange, disconnectUser } from "./live";

export const MAX_MEMBERS = 20;
export const MAX_TRIPS_PER_USER = 50;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Role = "owner" | "member";

async function lockTrip(tx: Tx, tripId: string): Promise<void> {
  const [row] = await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for("update");
  if (!row) throw new HttpError(404, "not_found");
}

// ---- Trips -------------------------------------------------------------------------------

export type CreateTripInput = {
  ownerId: string;
  name: string;
  startDate: string;
  days: number;
  destination: Destination | null;
  isDemo: boolean;
  locale: Locale;
  /** Replaces the default initial content (demo trips are built from a seed). */
  build?: (doc: Y.Doc) => void;
};

export async function createTrip(input: CreateTripInput): Promise<string> {
  const id = newTripId();
  await db.transaction(async (tx) => {
    // The id is fixed before the transaction, so a retry after a lost reply finds its own trip.
    const [existing] = await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, id));
    if (existing) return;
    // Serialise one user's creates so the limit cannot be raced past.
    const [owner] = await tx.select().from(user).where(eq(user.id, input.ownerId)).for("update");
    if (!owner) throw new HttpError(404, "not_found");
    const [{ owned }] = await tx.select({ owned: count() }).from(trips).where(eq(trips.ownerId, input.ownerId));
    if (owned >= MAX_TRIPS_PER_USER) throw new HttpError(409, "trip_limit");

    const doc = new Y.Doc();
    if (input.build) input.build(doc);
    else initTrip(doc, input, input.ownerId);
    upsertMember(doc, { id: owner.id, name: owner.name, colour: owner.colour });
    const view = readTrip(doc);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));

    await tx.insert(trips).values({
      id,
      name: view.name,
      startDate: view.startDate,
      days: view.days.length,
      destination: view.destination,
      ownerId: owner.id,
      isDemo: input.isDemo,
    });
    await tx.insert(tripMembers).values({ tripId: id, userId: owner.id, role: "owner" });
    await tx.insert(tripDocuments).values({ tripId: id, state, sizeBytes: state.length });
  });
  return id;
}

export type TripSummary = {
  id: string;
  name: string;
  startDate: string;
  days: number;
  destination: unknown;
  isDemo: boolean;
  role: Role;
  members: { id: string; name: string; colour: string }[];
};

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The user's trips: upcoming (or running) first by start date, then past ones, most recent first. */
export async function listTrips(userId: string, today: string = new Date().toISOString().slice(0, 10)): Promise<TripSummary[]> {
  const mine = await db
    .select({ trip: trips, role: tripMembers.role })
    .from(tripMembers)
    .innerJoin(trips, eq(trips.id, tripMembers.tripId))
    .where(and(eq(tripMembers.userId, userId), isNull(tripMembers.removedAt)));
  if (mine.length === 0) return [];
  const people = await db
    .select({ tripId: tripMembers.tripId, id: user.id, name: user.name, colour: user.colour })
    .from(tripMembers)
    .innerJoin(user, eq(user.id, tripMembers.userId))
    .where(and(inArray(tripMembers.tripId, mine.map((m) => m.trip.id)), isNull(tripMembers.removedAt)))
    .orderBy(asc(tripMembers.joinedAt));
  const summaries = mine.map(({ trip, role }) => ({
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    days: trip.days,
    destination: trip.destination,
    isDemo: trip.isDemo,
    role,
    members: people.filter((p) => p.tripId === trip.id).map(({ id, name, colour }) => ({ id, name, colour })),
  }));
  const endOf = (t: TripSummary) => addDays(t.startDate, t.days - 1);
  const upcoming = summaries.filter((t) => endOf(t) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = summaries.filter((t) => endOf(t) < today).sort((a, b) => b.startDate.localeCompare(a.startDate));
  return [...upcoming, ...past];
}

export async function getTrip(id: string) {
  const [row] = await db.select().from(trips).where(eq(trips.id, id));
  return row ?? null;
}

export async function patchTripMeta(
  tripId: string,
  userId: string,
  patch: { name?: string; startDate?: string; days?: number },
): Promise<void> {
  await applyServerChange(tripId, (doc) => {
    setTripMeta(doc, { name: patch.name, startDate: patch.startDate }, userId);
    if (patch.days === undefined) return;
    let { days } = readTrip(doc);
    for (let n = days.length; n < patch.days; n++) addDay(doc, userId);
    while (days.length > patch.days) {
      removeDay(doc, days[days.length - 1].id, userId);
      days = readTrip(doc).days;
    }
  });
}

/** Deletes the trip, leaving a tombstone in the same transaction, then closes members' live connections. */
export async function deleteTrip(id: string): Promise<void> {
  const members = await db.transaction(async (tx) => {
    await tx.insert(tripTombstones).values({ tripId: id }).onConflictDoNothing();
    const rows = await tx.select({ userId: tripMembers.userId }).from(tripMembers).where(eq(tripMembers.tripId, id));
    await tx.delete(trips).where(eq(trips.id, id));
    return rows;
  });
  for (const { userId } of members) disconnectUser(id, userId, "deleted");
}

// ---- Members -----------------------------------------------------------------------------

export async function listMembers(tripId: string) {
  return db
    .select({ id: user.id, name: user.name, colour: user.colour, role: tripMembers.role, joinedAt: tripMembers.joinedAt })
    .from(tripMembers)
    .innerJoin(user, eq(user.id, tripMembers.userId))
    .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.removedAt)))
    .orderBy(asc(tripMembers.joinedAt));
}

/**
 * Adds (or re-adds a removed) member. Already being a member is a no-op, even on a full trip.
 * The document's member mirror is refreshed either way, so a retry after a lost reply still mirrors.
 */
export async function addMember(tripId: string, userId: string, role: Role): Promise<void> {
  const [person] = await db.select().from(user).where(eq(user.id, userId));
  if (!person) throw new HttpError(404, "not_found");
  await db.transaction(async (tx) => {
    await lockTrip(tx, tripId);
    const [existing] = await tx
      .select({ removedAt: tripMembers.removedAt })
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)));
    if (existing && !existing.removedAt) return;
    const [{ active }] = await tx
      .select({ active: count() })
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.removedAt)));
    if (active >= MAX_MEMBERS) throw new HttpError(409, "trip_full");
    await tx
      .insert(tripMembers)
      .values({ tripId, userId, role })
      .onConflictDoUpdate({ target: [tripMembers.tripId, tripMembers.userId], set: { role, removedAt: null, joinedAt: sql`now()` } });
  });
  await applyServerChange(tripId, (doc) => upsertMember(doc, { id: person.id, name: person.name, colour: person.colour }));
}

/**
 * Soft removal: the row stays with `removed_at` set. The owner must transfer ownership first.
 * The member's live connections are closed with "removed".
 */
export async function removeMember(tripId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockTrip(tx, tripId);
    const [row] = await tx
      .select({ role: tripMembers.role })
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId), isNull(tripMembers.removedAt)));
    if (!row) throw new HttpError(404, "not_found");
    if (row.role === "owner") throw new HttpError(409, "owner_must_transfer");
    await tx
      .update(tripMembers)
      .set({ removedAt: new Date() })
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)));
  });
  disconnectUser(tripId, userId, "removed");
  await applyServerChange(tripId, (doc) => removeDocMember(doc, userId));
}

export async function transferOwnership(tripId: string, toUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockTrip(tx, tripId);
    const [target] = await tx
      .select({ userId: tripMembers.userId })
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, toUserId), isNull(tripMembers.removedAt)));
    if (!target) throw new HttpError(404, "not_found");
    await tx
      .update(tripMembers)
      .set({ role: sql`case when ${tripMembers.userId} = ${toUserId} then 'owner' else 'member' end` })
      .where(and(eq(tripMembers.tripId, tripId), sql`(${tripMembers.userId} = ${toUserId} or ${tripMembers.role} = 'owner')`));
    await tx.update(trips).set({ ownerId: toUserId }).where(eq(trips.id, tripId));
  });
}

/** Records activity, at most once an hour per user (it only feeds housekeeping). */
export async function touchUser(userId: string): Promise<void> {
  await db
    .update(user)
    .set({ lastActiveAt: new Date() })
    .where(and(eq(user.id, userId), sql`(${user.lastActiveAt} is null or ${user.lastActiveAt} < now() - interval '1 hour')`));
}

/** Refreshes the user's name and colour in the member mirror of every trip they are in. A trip that has vanished is skipped. */
export async function mirrorProfile(userId: string): Promise<void> {
  const [person] = await db.select().from(user).where(eq(user.id, userId));
  if (!person) return;
  const mine = await db
    .select({ tripId: tripMembers.tripId })
    .from(tripMembers)
    .where(and(eq(tripMembers.userId, userId), isNull(tripMembers.removedAt)));
  for (const { tripId } of mine) {
    try {
      await applyServerChange(tripId, (doc) => upsertMember(doc, { id: person.id, name: person.name, colour: person.colour }));
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
    }
  }
}

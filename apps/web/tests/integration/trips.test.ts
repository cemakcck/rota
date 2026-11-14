import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readTrip } from "@rota/trip";
import { GET as getTrip, PATCH as patchTrip, DELETE as deleteTrip } from "@/app/api/trips/[id]/route";
import { GET as listTrips, POST as createTrip } from "@/app/api/trips/route";
import { GET as listMembers } from "@/app/api/trips/[id]/members/route";
import { GET as listInvites, POST as postInvite } from "@/app/api/trips/[id]/invites/route";
import { DELETE as deleteInvite } from "@/app/api/trips/[id]/invites/[inviteId]/route";
import { DELETE as deleteMember } from "@/app/api/trips/[id]/members/[userId]/route";
import { POST as transfer } from "@/app/api/trips/[id]/members/[userId]/owner/route";
import { db } from "@/server/db/client";
import { tripDocuments, tripMembers, tripTombstones, trips, user } from "@/server/db/schema";
import { createTrip as createTripRow } from "@/server/trips/repo";
import { NEW_TRIP, call, signUpUser } from "./helpers";

async function create(as: Awaited<ReturnType<typeof signUpUser>>, body: object = NEW_TRIP) {
  const res = await call(createTrip, "POST", as, { body });
  return { res, id: ((await res.clone().json()) as { id?: string }).id! };
}

describe("trips", () => {
  it("a user creates a trip and is its owner", async () => {
    const ann = await signUpUser({ name: "Ann" });
    const { res, id } = await create(ann);
    expect(res.status).toBe(201);
    expect(id).toMatch(/^[0-9A-Za-z]{22}$/);

    const got = await call(getTrip, "GET", ann, { params: { id } });
    expect(got.status).toBe(200);
    const body = (await got.json()) as { name: string; role: string; days: number; members: { id: string; name: string }[] };
    expect(body).toMatchObject({ name: "Lisbon", role: "owner", days: 3 });
    expect(body.members.map((m) => m.name)).toEqual(["Ann"]);

    const [doc] = await db.select().from(tripDocuments).where(eq(tripDocuments.tripId, id));
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, doc.state);
    const view = readTrip(ydoc);
    expect(view.days).toHaveLength(3);
    expect(view.members.map((m) => m.id)).toEqual([ann.id]);

    const list = (await (await call(listTrips, "GET", ann)).json()) as { id: string; role: string }[];
    expect(list.map((t) => t.id)).toEqual([id]);
    expect((await call(createTrip, "POST", ann, { body: { ...NEW_TRIP, name: "" } })).status).toBe(400);
    expect((await call(createTrip, "POST", ann, { body: { ...NEW_TRIP, days: 31 } })).status).toBe(400);
    expect((await call(createTrip, "POST", null, { body: NEW_TRIP })).status).toBe(401);
  });

  it("non-members get 404 for every trip route", async () => {
    const ann = await signUpUser();
    const eve = await signUpUser();
    const { id } = await create(ann);
    const p = { id };
    const pu = { id, userId: ann.id };
    const results = await Promise.all([
      call(getTrip, "GET", eve, { params: p }),
      call(patchTrip, "PATCH", eve, { params: p, body: { name: "x" } }),
      call(deleteTrip, "DELETE", eve, { params: p }),
      call(listMembers, "GET", eve, { params: p }),
      call(deleteMember, "DELETE", eve, { params: pu }),
      call(transfer, "POST", eve, { params: { id, userId: eve.id } }),
      call(listInvites, "GET", eve, { params: p }),
      call(postInvite, "POST", eve, { params: p, body: { kind: "link" } }),
      call(deleteInvite, "DELETE", eve, { params: { id, inviteId: "x" } }),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(9).fill(404));
    expect((await call(getTrip, "GET", eve, { params: { id: "not-a-trip-id" } })).status).toBe(404);
    expect((await (await call(listTrips, "GET", eve)).json()) as unknown[]).toEqual([]);
  });

  it("any member can rename; only the owner deletes", async () => {
    const ann = await signUpUser();
    const bob = await signUpUser({ name: "Bob" });
    const { id } = await create(ann);
    const { createLinkInvite, acceptLink } = await import("@/server/trips/invites");
    await acceptLink((await createLinkInvite(id, ann.id)).token, bob.id);

    const renamed = await call(patchTrip, "PATCH", bob, { params: { id }, body: { name: "Porto", startDate: "2027-06-01", days: 5 } });
    expect(renamed.status).toBe(204);
    const [row] = await db.select().from(trips).where(eq(trips.id, id));
    expect(row).toMatchObject({ name: "Porto", startDate: "2027-06-01", days: 5 });
    const [doc] = await db.select().from(tripDocuments).where(eq(tripDocuments.tripId, id));
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, doc.state);
    expect(readTrip(ydoc)).toMatchObject({ name: "Porto", startDate: "2027-06-01" });
    expect(readTrip(ydoc).days).toHaveLength(5);
    expect((await call(patchTrip, "PATCH", bob, { params: { id }, body: { days: 0 } })).status).toBe(400);

    expect((await call(deleteTrip, "DELETE", bob, { params: { id } })).status).toBe(403);
    expect((await call(deleteTrip, "DELETE", ann, { params: { id } })).status).toBe(204);
    expect(await db.select().from(trips).where(eq(trips.id, id))).toEqual([]);
    expect(await db.select().from(tripTombstones).where(eq(tripTombstones.tripId, id))).toHaveLength(1);
    expect((await call(getTrip, "GET", ann, { params: { id } })).status).toBe(404);
  });

  it("the 51st trip is refused", async () => {
    const ann = await signUpUser();
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push(await createTripRow({ ownerId: ann.id, name: `T${i}`, startDate: "2027-05-01", days: 1, destination: null, isDemo: false, locale: "en" }));
    const res = await call(createTrip, "POST", ann, { body: NEW_TRIP });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "trip_limit" });
    expect(ids).toHaveLength(50);
  });

  it("a custom build replaces the default initial content", async () => {
    const ann = await signUpUser({ name: "Ann" });
    const id = await createTripRow({
      ownerId: ann.id, name: "Seeded", startDate: "2027-05-01", days: 2, destination: null, isDemo: true, locale: "en",
      build: (doc) => doc.getMap("meta").set("name", "From seed"),
    });
    const [doc] = await db.select().from(tripDocuments).where(eq(tripDocuments.tripId, id));
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, doc.state);
    expect(readTrip(ydoc).name).toBe("From seed");
    expect(readTrip(ydoc).members.map((m) => m.id)).toEqual([ann.id]);
    expect((await db.select().from(user).where(eq(user.id, ann.id)))[0].id).toBe(ann.id);
  });

  it("deleting a trip does not leave members dangling", async () => {
    const ann = await signUpUser();
    const { id } = await create(ann);
    await call(deleteTrip, "DELETE", ann, { params: { id } });
    expect(await db.select().from(tripMembers).where(eq(tripMembers.tripId, id))).toEqual([]);
  });
});

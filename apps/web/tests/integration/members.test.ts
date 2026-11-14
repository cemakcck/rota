import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readTrip } from "@rota/trip";
import { GET as getTrip } from "@/app/api/trips/[id]/route";
import { POST as createTrip } from "@/app/api/trips/route";
import { GET as listMembers } from "@/app/api/trips/[id]/members/route";
import { DELETE as deleteMember } from "@/app/api/trips/[id]/members/[userId]/route";
import { POST as transfer } from "@/app/api/trips/[id]/members/[userId]/owner/route";
import { db } from "@/server/db/client";
import { tripDocuments, tripMembers, trips } from "@/server/db/schema";
import { addMember } from "@/server/trips/repo";
import { NEW_TRIP, call, insertUser, signUpUser } from "./helpers";

async function tripWith(owner: Awaited<ReturnType<typeof signUpUser>>, ...others: Awaited<ReturnType<typeof signUpUser>>[]) {
  const res = await call(createTrip, "POST", owner, { body: NEW_TRIP });
  const { id } = (await res.json()) as { id: string };
  for (const o of others) await addMember(id, o.id, "member");
  return id;
}

const docMemberIds = async (id: string) => {
  const [doc] = await db.select().from(tripDocuments).where(eq(tripDocuments.tripId, id));
  const y = new Y.Doc();
  Y.applyUpdate(y, doc.state);
  return readTrip(y).members.map((m) => m.id).sort();
};

describe("members", () => {
  it("the 21st member is refused", async () => {
    const ann = await signUpUser();
    const id = await tripWith(ann);
    for (let i = 0; i < 19; i++) await addMember(id, await insertUser(), "member");
    await expect(addMember(id, await insertUser(), "member")).rejects.toMatchObject({ status: 409, message: "trip_full" });
    // Adding someone who is already in stays fine at the cap.
    await expect(addMember(id, ann.id, "member")).resolves.toBeUndefined();
    expect((await db.select().from(tripMembers).where(eq(tripMembers.tripId, id)))).toHaveLength(20);
  });

  it("the owner cannot leave without transferring ownership", async () => {
    const ann = await signUpUser();
    const bob = await signUpUser({ name: "Bob" });
    const id = await tripWith(ann, bob);
    const res = await call(deleteMember, "DELETE", ann, { params: { id, userId: ann.id } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "owner_must_transfer" });
    expect((await call(getTrip, "GET", ann, { params: { id } })).status).toBe(200);
  });

  it("transferring ownership swaps roles", async () => {
    const ann = await signUpUser();
    const bob = await signUpUser({ name: "Bob" });
    const cat = await signUpUser({ name: "Cat" });
    const id = await tripWith(ann, bob, cat);
    expect((await call(transfer, "POST", bob, { params: { id, userId: bob.id } })).status).toBe(403);
    expect((await call(transfer, "POST", ann, { params: { id, userId: (await insertUser()) } })).status).toBe(404);
    expect((await call(transfer, "POST", ann, { params: { id, userId: bob.id } })).status).toBe(204);
    const roles = Object.fromEntries((await db.select().from(tripMembers).where(eq(tripMembers.tripId, id))).map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [ann.id]: "member", [bob.id]: "owner", [cat.id]: "member" });
    expect((await db.select().from(trips).where(eq(trips.id, id)))[0].ownerId).toBe(bob.id);
    // The former owner can now leave.
    expect((await call(deleteMember, "DELETE", ann, { params: { id, userId: ann.id } })).status).toBe(204);
  });

  it("removal is soft: the member loses access, the row stays, and re-adding restores it", async () => {
    const ann = await signUpUser();
    const bob = await signUpUser({ name: "Bob" });
    const cat = await signUpUser({ name: "Cat" });
    const id = await tripWith(ann, bob, cat);
    expect(await docMemberIds(id)).toEqual([ann.id, bob.id, cat.id].sort());

    expect((await call(deleteMember, "DELETE", cat, { params: { id, userId: bob.id } })).status).toBe(403);
    expect((await call(deleteMember, "DELETE", ann, { params: { id, userId: bob.id } })).status).toBe(204);
    expect((await call(getTrip, "GET", bob, { params: { id } })).status).toBe(404);
    const [row] = await db.select().from(tripMembers).where(and(eq(tripMembers.tripId, id), eq(tripMembers.userId, bob.id)));
    expect(row.removedAt).toBeInstanceOf(Date);
    expect(await docMemberIds(id)).toEqual([ann.id, cat.id].sort());
    const list = (await (await call(listMembers, "GET", ann, { params: { id } })).json()) as { id: string }[];
    expect(list.map((m) => m.id).sort()).toEqual([ann.id, cat.id].sort());
    expect((await call(deleteMember, "DELETE", ann, { params: { id, userId: bob.id } })).status).toBe(404);

    await addMember(id, bob.id, "member");
    expect((await call(getTrip, "GET", bob, { params: { id } })).status).toBe(200);
    expect(await docMemberIds(id)).toEqual([ann.id, bob.id, cat.id].sort());
    // A member leaving themself.
    expect((await call(deleteMember, "DELETE", cat, { params: { id, userId: cat.id } })).status).toBe(204);
  });
});

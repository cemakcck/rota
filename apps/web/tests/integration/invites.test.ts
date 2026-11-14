import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createTrip } from "@/app/api/trips/route";
import { GET as listInvites, POST as postInvite } from "@/app/api/trips/[id]/invites/route";
import { DELETE as deleteInvite } from "@/app/api/trips/[id]/invites/[inviteId]/route";
import { POST as accept } from "@/app/api/invites/[token]/route";
import { db } from "@/server/db/client";
import { tripInvites, tripMembers } from "@/server/db/schema";
import { createLinkInvite } from "@/server/trips/invites";
import { DELETE as deleteMember } from "@/app/api/trips/[id]/members/[userId]/route";
import * as email from "@/server/email";
import { NEW_TRIP, call, randomIp, signUpUser } from "./helpers";

const sent: email.EmailMessage[] = [];
beforeEach(() => {
  sent.length = 0;
  vi.spyOn(email, "sendEmail").mockImplementation(async (m) => {
    sent.push(m);
  });
});

async function newTrip(owner: Awaited<ReturnType<typeof signUpUser>>) {
  const res = await call(createTrip, "POST", owner, { body: NEW_TRIP });
  return ((await res.json()) as { id: string }).id;
}
const link = async (owner: Awaited<ReturnType<typeof signUpUser>>, id: string) =>
  ((await (await call(postInvite, "POST", owner, { params: { id }, body: { kind: "link" } })).json()) as { token: string }).token;
const members = async (id: string) => (await db.select().from(tripMembers).where(eq(tripMembers.tripId, id))).map((m) => m.userId).sort();

describe("invites", () => {
  it("a link invite joins a signed-in user, twice is idempotent, a regenerated link kills the old one", async () => {
    const ann = await signUpUser();
    const bob = await signUpUser({ name: "Bob" });
    const id = await newTrip(ann);
    const token = await link(ann, id);
    expect(token).toMatch(/^[0-9A-Za-z]{43}$/);

    const stored = await db.select().from(tripInvites).where(eq(tripInvites.tripId, id));
    expect(stored.map((i) => i.tokenHash)).not.toContain(token);
    expect(stored[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const first = await call(accept, "POST", bob, { params: { token } });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ tripId: id });
    expect((await call(accept, "POST", bob, { params: { token } })).status).toBe(200);
    expect(await members(id)).toEqual([ann.id, bob.id].sort());
    expect((await call(accept, "POST", null, { params: { token } })).status).toBe(401);

    const fresh = await link(ann, id);
    expect(fresh).not.toBe(token);
    const cat = await signUpUser({ name: "Cat" });
    expect((await call(accept, "POST", cat, { params: { token } })).status).toBe(404);
    expect((await call(accept, "POST", cat, { params: { token: fresh } })).status).toBe(200);
    expect((await call(accept, "POST", cat, { params: { token: "nope" } })).status).toBe(404);

    // Only the owner manages invites; revoking kills the link.
    expect((await call(postInvite, "POST", bob, { params: { id }, body: { kind: "link" } })).status).toBe(403);
    const listed = (await (await call(listInvites, "GET", ann, { params: { id } })).json()) as { id: string; kind: string; tokenHash?: string }[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("tokenHash");
    expect((await call(deleteInvite, "DELETE", ann, { params: { id, inviteId: listed[0].id } })).status).toBe(204);
    expect((await call(accept, "POST", await signUpUser(), { params: { token: fresh } })).status).toBe(404);
  });

  it("an email invite to an existing user adds them and sends an email", async () => {
    const ann = await signUpUser({ name: "Ann" });
    const bob = await signUpUser({ name: "Bob" });
    const id = await newTrip(ann);
    const res = await call(postInvite, "POST", ann, { params: { id }, body: { kind: "email", email: ` ${bob.email.toUpperCase()} ` } });
    expect(res.status).toBe(201);
    expect(await members(id)).toEqual([ann.id, bob.id].sort());
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(bob.email);
    expect(sent[0].text).toContain(`/en/t/${id}`);
    // Inviting a current member again sends nothing.
    await call(postInvite, "POST", ann, { params: { id }, body: { kind: "email", email: bob.email } });
    expect(sent).toHaveLength(1);
    expect((await call(postInvite, "POST", ann, { params: { id }, body: { kind: "email", email: "not-an-email" } })).status).toBe(400);
  });

  it("an email invite to a new address joins them when they sign up with it", async () => {
    const ann = await signUpUser({ name: "Ann" });
    const id = await newTrip(ann);
    const address = `New.Person.${Date.now()}@Test.Rota`;
    const res = await call(postInvite, "POST", ann, { params: { id }, body: { kind: "email", email: address } });
    expect(res.status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(address.toLowerCase());
    expect(sent[0].text).toContain(`/en/sign-up?email=${encodeURIComponent(address.toLowerCase())}`);
    expect(await members(id)).toEqual([ann.id]);

    const joiner = await signUpUser({ email: address.toUpperCase() });
    expect(await members(id)).toEqual([ann.id, joiner.id].sort());
    const [invite] = await db.select().from(tripInvites).where(eq(tripInvites.tripId, id));
    expect(invite.revokedAt).toBeInstanceOf(Date);
  });

  it("a retried link creation (same token) still returns a working token", async () => {
    const ann = await signUpUser();
    const id = await newTrip(ann);
    const token = randomBytes(32).toString("base64url").slice(0, 43); // fresh per run: the test DB persists
    await createLinkInvite(id, ann.id, token);
    await createLinkInvite(id, ann.id, token); // the retry after a lost reply
    const bob = await signUpUser();
    expect((await call(accept, "POST", bob, { params: { token } })).status).toBe(200);
  });

  it("an invite link never re-activates a removed member, but an owner email invite does", async () => {
    const ann = await signUpUser({ name: "Ann" });
    const bob = await signUpUser({ name: "Bob" });
    const id = await newTrip(ann);
    const token = await link(ann, id);
    await call(accept, "POST", bob, { params: { token } });
    expect((await call(deleteMember, "DELETE", ann, { params: { id, userId: bob.id } })).status).toBe(204);

    expect((await call(accept, "POST", bob, { params: { token } })).status).toBe(404);
    const [row] = await db.select().from(tripMembers).where(and(eq(tripMembers.tripId, id), eq(tripMembers.userId, bob.id)));
    expect(row.removedAt).toBeInstanceOf(Date);

    await call(postInvite, "POST", ann, { params: { id }, body: { kind: "email", email: bob.email } });
    const [again] = await db.select().from(tripMembers).where(and(eq(tripMembers.tripId, id), eq(tripMembers.userId, bob.id)));
    expect(again.removedAt).toBeNull();
  });

  it("email invites are limited to 20 a day per user, and an address with a pending invite is not emailed again", async () => {
    const ann = await signUpUser({ name: "Ann" });
    const id = await newTrip(ann);
    const address = `pending-${randomBytes(6).toString("hex")}@test.rota`;
    const invite = (email: string) => call(postInvite, "POST", ann, { params: { id }, body: { kind: "email", email } });
    expect((await invite(address)).status).toBe(201);
    const again = await invite(address);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ status: "pending" });
    expect(sent).toHaveLength(1);

    for (let i = 2; i < 20; i++) expect((await invite(`spam-${i}-${randomBytes(6).toString("hex")}@test.rota`)).status).toBe(201);
    const refused = await invite(`spam-21-${randomBytes(6).toString("hex")}@test.rota`);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "rate_limited" });
    expect(sent).toHaveLength(19);
    // Link invites are not counted.
    expect((await call(postInvite, "POST", ann, { params: { id }, body: { kind: "link" } })).status).toBe(201);
  });

  it("email invites are limited per IP too, across accounts", async () => {
    const ip = randomIp();
    const users = [await signUpUser({ ip }), await signUpUser({ ip }), await signUpUser({ ip })];
    const statuses: number[] = [];
    for (const u of users) {
      const id = await newTrip(u);
      for (let i = 0; i < 20; i++) {
        const res = await call(postInvite, "POST", u, { params: { id }, body: { kind: "email", email: `ip-${randomBytes(6).toString("hex")}@test.rota` } });
        statuses.push(res.status);
      }
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(40);
    expect(statuses.filter((s) => s === 429)).toHaveLength(20);
  });
});

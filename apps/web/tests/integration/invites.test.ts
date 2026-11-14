import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createTrip } from "@/app/api/trips/route";
import { GET as listInvites, POST as postInvite } from "@/app/api/trips/[id]/invites/route";
import { DELETE as deleteInvite } from "@/app/api/trips/[id]/invites/[inviteId]/route";
import { POST as accept } from "@/app/api/invites/[token]/route";
import { db } from "@/server/db/client";
import { tripInvites, tripMembers } from "@/server/db/schema";
import * as email from "@/server/email";
import { NEW_TRIP, call, signUpUser } from "./helpers";

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
});

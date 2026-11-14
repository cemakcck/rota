import { randomUUID } from "node:crypto";
import { eq, like, or } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { readTrip } from "@rota/trip";
import { POST as startDemoRoute } from "@/app/api/demo/route";
import { POST as friendTokenRoute } from "@/app/api/demo/friend-token/route";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { tripDocuments, tripMembers, trips, user } from "@/server/db/schema";
import { hashIp } from "@/server/ipHash";
import { hit } from "@/server/rateLimit";
import { ORIGIN, call, signUpUser } from "./helpers";

const post = (ip: string, body: object = { locale: "en" }) =>
  startDemoRoute(
    new Request(`${ORIGIN}/api/demo`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );

const newIp = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;

describe("demo accounts", () => {
  it("POST /api/demo signs the visitor in and opens a seeded trip they own", { timeout: 30_000 }, async () => {
    const res = await post(newIp());
    expect(res.status).toBe(201);
    const { tripId } = (await res.json()) as { tripId: string };

    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.name).toMatch(/^Guest /);
    const visitorId = session!.user.id;
    const [row] = await db.select().from(user).where(eq(user.id, visitorId));
    expect(row.isDemo).toBe(true);

    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
    expect(trip).toMatchObject({ ownerId: visitorId, isDemo: true, name: "Istanbul long weekend", days: 3 });
    const members = await db.select().from(tripMembers).where(eq(tripMembers.tripId, tripId));
    expect(members).toHaveLength(3);
    expect(members.find((m) => m.userId === visitorId)?.role).toBe("owner");

    const [stored] = await db.select().from(tripDocuments).where(eq(tripDocuments.tripId, tripId));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, stored.state);
    const view = readTrip(doc);
    expect(view.days.flatMap((d) => d.places)).toHaveLength(12);
    expect(view.suggestions).toHaveLength(2);
    expect(view.members.map((m) => m.name).sort()).toEqual([session!.user.name, "Deniz", "Selin"].sort());
  });

  it("a Turkish visitor gets a Turkish name and trip", { timeout: 30_000 }, async () => {
    const res = await post(newIp(), { locale: "tr" });
    const { tripId } = (await res.json()) as { tripId: string };
    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
    expect(trip.name).toBe("İstanbul'da uzun hafta sonu");
    const [owner] = await db.select().from(user).where(eq(user.id, trip.ownerId));
    expect(owner.name).toMatch(/^Misafir /);
  });

  it("the 21st demo start from one IP is refused", { timeout: 30_000 }, async () => {
    const ip = newIp();
    for (let i = 0; i < 19; i++) await hit("demo:" + hashIp(ip), 20, 86400);
    expect((await post(ip)).status).toBe(201); // the 20th
    const refused = await post(ip); // the 21st
    expect(refused.status).toBe(429);
    expect(refused.headers.getSetCookie()).toEqual([]);
  });

  it("a start that fails midway leaves no demo users or trip behind", { timeout: 30_000 }, async () => {
    const demoUsers = async () =>
      (await db.select({ id: user.id }).from(user).where(or(like(user.email, "%@friend.demo.invalid"), like(user.email, "%@visitor.demo.invalid")))).length;
    const tripCount = async () => (await db.select({ id: trips.id }).from(trips).where(eq(trips.isDemo, true))).length;
    const before = [await demoUsers(), await tripCount()];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(auth.api, "signInEmail").mockRejectedValueOnce(new Error("sign-in down"));
    try {
      expect((await post(newIp())).status).toBe(500);
    } finally {
      vi.restoreAllMocks();
      logged.mockRestore();
    }
    expect([await demoUsers(), await tripCount()]).toEqual(before);
  });

  it("rejects a bad locale", async () => {
    expect((await post(newIp(), { locale: "de" })).status).toBe(400);
  });

  it("friend-token returns a working bearer session for Deniz only to the demo trip's owner", { timeout: 30_000 }, async () => {
    const res = await post(newIp());
    const { tripId } = (await res.json()) as { tripId: string };
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    const visitor = { id: session!.user.id, token: "", email: "", name: "", cookie, ip: newIp() };
    // Bearer-only caller for the owner: reuse the cookie's token (signed) via Authorization.
    const ownerToken = decodeURIComponent(cookie.split("=").slice(1).join("="));

    const ok = await call(friendTokenRoute, "POST", { ...visitor, token: ownerToken }, { body: { tripId } });
    expect(ok.status).toBe(200);
    const { token, user: deniz } = (await ok.json()) as { token: string; user: { id: string; name: string; colour: string } };
    expect(deniz.name).toBe("Deniz");
    const viaBearer = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
    expect(viaBearer?.user.id).toBe(deniz.id);

    // Deniz himself, a stranger, and a non-demo trip all get the same 404.
    const asDeniz = await call(friendTokenRoute, "POST", { ...visitor, token }, { body: { tripId } });
    expect(asDeniz.status).toBe(404);
    const stranger = await signUpUser({ name: "Stranger" });
    expect((await call(friendTokenRoute, "POST", stranger, { body: { tripId } })).status).toBe(404);
    expect((await call(friendTokenRoute, "POST", null, { body: { tripId } })).status).toBe(401);
  });
});

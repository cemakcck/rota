import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { MEMBER_COLOURS, readTrip } from "@rota/trip";
import { PATCH as patchProfile } from "@/app/api/profile/route";
import { POST as createTrip } from "@/app/api/trips/route";
import { db } from "@/server/db/client";
import { tripDocuments, user } from "@/server/db/schema";
import { NEW_TRIP, call, signUpUser } from "./helpers";

async function mirrored(tripId: string) {
  const [doc] = await db.select().from(tripDocuments).where(eq(tripDocuments.tripId, tripId));
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, doc.state);
  return readTrip(ydoc).members;
}

describe("profile", () => {
  it("changing name and colour updates the user and the member mirror of every trip", async () => {
    const ann = await signUpUser({ name: "Ann" });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await call(createTrip, "POST", ann, { body: NEW_TRIP });
      ids.push(((await res.json()) as { id: string }).id);
    }
    const res = await call(patchProfile, "PATCH", ann, { body: { name: "  Anna  ", colour: MEMBER_COLOURS[5] } });
    expect(res.status).toBe(204);
    const [row] = await db.select().from(user).where(eq(user.id, ann.id));
    expect(row).toMatchObject({ name: "Anna", colour: MEMBER_COLOURS[5] });
    for (const id of ids) expect(await mirrored(id)).toEqual([{ id: ann.id, name: "Anna", colour: MEMBER_COLOURS[5] }]);
  });

  it("rejects a bad name or colour, and needs a session", async () => {
    const ann = await signUpUser({ name: "Ann" });
    expect((await call(patchProfile, "PATCH", ann, { body: { name: "", colour: MEMBER_COLOURS[0] } })).status).toBe(400);
    expect((await call(patchProfile, "PATCH", ann, { body: { name: "x".repeat(31), colour: MEMBER_COLOURS[0] } })).status).toBe(400);
    expect((await call(patchProfile, "PATCH", ann, { body: { name: "Ann", colour: "#000000" } })).status).toBe(400);
    expect((await call(patchProfile, "PATCH", null, { body: { name: "Ann", colour: MEMBER_COLOURS[0] } })).status).toBe(401);
    const [row] = await db.select().from(user).where(eq(user.id, ann.id));
    expect(row.name).toBe("Ann");
  });
});

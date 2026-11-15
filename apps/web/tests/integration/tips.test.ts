import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DELETE as resetTips, GET as getTips, PUT as markTips } from "@/app/api/profile/tips/route";
import { db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { call, signUpUser } from "./helpers";

const seen = async (as: Awaited<ReturnType<typeof signUpUser>>) => ((await (await call(getTips, "GET", as)).json()) as { seen: boolean }).seen;

describe("first-time tips", () => {
  it("are unseen at first, remembered once seen, and shown again after a reset", async () => {
    const ann = await signUpUser({ name: "Ann" });
    expect(await seen(ann)).toBe(false);

    expect((await call(markTips, "PUT", ann)).status).toBe(204);
    expect(await seen(ann)).toBe(true);
    const [row] = await db.select().from(user).where(eq(user.id, ann.id));
    expect(row.tipsSeenAt).toBeInstanceOf(Date);

    // Seen again (another device): the first time is kept.
    await call(markTips, "PUT", ann);
    const [again] = await db.select().from(user).where(eq(user.id, ann.id));
    expect(again.tipsSeenAt).toEqual(row.tipsSeenAt);

    expect((await call(resetTips, "DELETE", ann)).status).toBe(204);
    expect(await seen(ann)).toBe(false);
    const [reset] = await db.select().from(user).where(eq(user.id, ann.id));
    expect(reset.tipsSeenAt).toBeNull();
  });

  it("are per user, demo users included, and need a session", async () => {
    const ann = await signUpUser({ name: "Ann" });
    const guest = await signUpUser({ name: "Guest" });
    await db.update(user).set({ isDemo: true }).where(eq(user.id, guest.id));

    await call(markTips, "PUT", guest);
    expect(await seen(guest)).toBe(true);
    expect(await seen(ann)).toBe(false);

    for (const [handler, method] of [
      [getTips, "GET"],
      [markTips, "PUT"],
      [resetTips, "DELETE"],
    ] as const)
      expect((await call(handler, method, null)).status).toBe(401);
  });
});

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { route } from "@/server/http";

/**
 * The caller's first-time tour (spec §4): whether they have seen it (on any device), marking it seen
 * when they finish or skip it, and "Show tips again" (settings) clearing that. Demo users too.
 */
export const GET = route(async ({ user: me }) => {
  const [row] = await db.select({ tipsSeenAt: user.tipsSeenAt }).from(user).where(eq(user.id, me.id));
  return { seen: row?.tipsSeenAt != null };
});

/** Seen: the first time is kept, so a second device finishing it changes nothing. */
export const PUT = route(async ({ user: me }) => {
  await db
    .update(user)
    .set({ tipsSeenAt: new Date() })
    .where(and(eq(user.id, me.id), isNull(user.tipsSeenAt)));
});

export const DELETE = route(async ({ user: me }) => {
  await db.update(user).set({ tipsSeenAt: null }).where(eq(user.id, me.id));
});

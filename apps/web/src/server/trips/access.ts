import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { tripMembers } from "../db/schema";
import { HttpError } from "../httpError";

export type Role = "owner" | "member";

/** 404 for non-members and removed members alike, so a trip's existence is never leaked. */
export async function requireMember(userId: string, tripId: string): Promise<{ role: Role }> {
  const [row] = await db
    .select({ role: tripMembers.role })
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId), isNull(tripMembers.removedAt)));
  if (!row) throw new HttpError(404, "not_found");
  return row;
}

export async function requireOwner(userId: string, tripId: string): Promise<{ role: "owner" }> {
  const { role } = await requireMember(userId, tripId);
  if (role !== "owner") throw new HttpError(403, "forbidden");
  return { role };
}

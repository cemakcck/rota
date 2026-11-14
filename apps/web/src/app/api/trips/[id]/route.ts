import { z } from "zod";
import { dateString } from "../route";
import { HttpError } from "@/server/httpError";
import { parseBody, route } from "@/server/http";
import { requireMember, requireOwner } from "@/server/trips/access";
import { deleteTrip, getTrip, listMembers, patchTripMeta } from "@/server/trips/repo";
import { isTripId } from "@rota/trip";

const patch = z
  .object({ name: z.string().trim().min(1).max(60), startDate: dateString, days: z.number().int().min(1).max(30) })
  .partial()
  .refine((p) => Object.keys(p).length > 0);

/** Trip ids that cannot exist are the same 404 as trips the caller may not see. */
export function tripIdParam(params: Record<string, string>): string {
  if (!isTripId(params.id)) throw new HttpError(404, "not_found");
  return params.id;
}

export const GET = route(async ({ user, params }) => {
  const id = tripIdParam(params);
  const { role } = await requireMember(user.id, id);
  const trip = await getTrip(id);
  if (!trip) throw new HttpError(404, "not_found");
  const { friendRanAt, ...visible } = trip;
  void friendRanAt; // housekeeping state, not for clients
  return { ...visible, role, members: await listMembers(id) };
});

export const PATCH = route(async ({ req, user, params }) => {
  const id = tripIdParam(params);
  await requireMember(user.id, id);
  await patchTripMeta(id, user.id, await parseBody(req, patch));
});

export const DELETE = route(async ({ user, params }) => {
  const id = tripIdParam(params);
  await requireOwner(user.id, id);
  await deleteTrip(id);
});

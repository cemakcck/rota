import { HttpError } from "@/server/httpError";
import { route } from "@/server/http";
import { requireOwner } from "@/server/trips/access";
import { revokeInvite } from "@/server/trips/invites";
import { tripIdParam } from "../../route";

export const DELETE = route(async ({ user, params }) => {
  const id = tripIdParam(params);
  await requireOwner(user.id, id);
  if (!(await revokeInvite(id, params.inviteId))) throw new HttpError(404, "not_found");
});

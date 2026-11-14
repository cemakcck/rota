import { HttpError } from "@/server/httpError";
import { route } from "@/server/http";
import { requireMember } from "@/server/trips/access";
import { removeMember } from "@/server/trips/repo";
import { tripIdParam } from "../../route";

/** The owner removes anyone else; a member removes only themself (leaving). */
export const DELETE = route(async ({ user, params }) => {
  const id = tripIdParam(params);
  const { role } = await requireMember(user.id, id);
  if (params.userId !== user.id && role !== "owner") throw new HttpError(403, "forbidden");
  await removeMember(id, params.userId);
});

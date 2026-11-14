import { route } from "@/server/http";
import { requireOwner } from "@/server/trips/access";
import { transferOwnership } from "@/server/trips/repo";
import { tripIdParam } from "../../../route";

export const POST = route(async ({ user, params }) => {
  const id = tripIdParam(params);
  await requireOwner(user.id, id);
  await transferOwnership(id, params.userId);
});

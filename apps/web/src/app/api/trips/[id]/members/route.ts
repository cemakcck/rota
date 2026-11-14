import { route } from "@/server/http";
import { requireMember } from "@/server/trips/access";
import { listMembers } from "@/server/trips/repo";
import { tripIdParam } from "../route";

export const GET = route(async ({ user, params }) => {
  const id = tripIdParam(params);
  await requireMember(user.id, id);
  return listMembers(id);
});

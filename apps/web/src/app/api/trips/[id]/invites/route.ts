import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { clientIp } from "@/server/ipHash";
import { requireOwner } from "@/server/trips/access";
import { createLinkInvite, inviteEmail, limitEmailInvites, listInvites } from "@/server/trips/invites";
import { tripIdParam } from "../route";

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link") }),
  z.object({ kind: z.literal("email"), email: z.string().trim().max(254).pipe(z.email()) }),
]);

export const GET = route(async ({ user, params }) => {
  const id = tripIdParam(params);
  await requireOwner(user.id, id);
  return listInvites(id);
});

export const POST = route(async ({ req, user, params }) => {
  const id = tripIdParam(params);
  await requireOwner(user.id, id);
  const input = await parseBody(req, body);
  if (input.kind === "link") return { status: 201, body: await createLinkInvite(id, user.id) };
  await limitEmailInvites(user.id, clientIp(req));
  return { status: 201, body: await inviteEmail(id, input.email, user.id) };
});

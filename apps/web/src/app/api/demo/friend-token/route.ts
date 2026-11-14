import { z } from "zod";
import { friendToken } from "@/server/demo";
import { parseBody, route } from "@/server/http";

const body = z.object({ tripId: z.string().min(1).max(64) });

export const POST = route(async ({ req, user }) => {
  const { tripId } = await parseBody(req, body);
  return friendToken(tripId, user.id);
});

import { z } from "zod";
import { APIError } from "better-auth/api";
import { auth } from "@/server/auth";
import { HttpError } from "@/server/httpError";
import { parseBody, route } from "@/server/http";
import { mirrorProfile } from "@/server/trips/repo";

const body = z.object({ name: z.string(), colour: z.string() });

/**
 * Changes the caller's name and colour. Better Auth's update-user does the validation (its hook is the
 * one rule for names and colours), then every trip the user is in gets the new values in its member mirror.
 */
export const PATCH = route(async ({ req, user }) => {
  const input = await parseBody(req, body);
  try {
    await auth.api.updateUser({ headers: req.headers, body: input });
  } catch (err) {
    if (err instanceof APIError) throw new HttpError(400, "invalid_body");
    throw err;
  }
  await mirrorProfile(user.id);
});

import type { IncomingMessage } from "node:http";
import { isMemberColour } from "@rota/trip";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import { db } from "./db/client";
import * as schema from "./db/schema";
import { resetPasswordMessage, sendEmail } from "./email";
import { clientIp, hashIp, toHeaders } from "./ipHash";
import { hit } from "./rateLimit";

const SIGN_UPS_PER_IP_PER_DAY = 20;
const DAY_SEC = 86_400;

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      // Not awaited: response time must not reveal whether the address has an account.
      void sendEmail(resetPasswordMessage(user.email, url)).catch((e) => console.error("[email] password reset failed", e));
    },
  },
  user: {
    additionalFields: {
      colour: { type: "string", required: true, input: true },
      isDemo: { type: "boolean", required: false, defaultValue: false, input: false },
      lastActiveAt: { type: "date", required: false, input: false },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const signUp = ctx.path === "/sign-up/email";
      if (!signUp && ctx.path !== "/update-user") return;
      const body = (ctx.body ?? {}) as { name?: unknown; colour?: unknown };
      let name: string | undefined;
      if (signUp || body.name !== undefined) {
        name = typeof body.name === "string" ? body.name.trim() : "";
        if (name.length < 1 || name.length > 30) {
          throw new APIError("BAD_REQUEST", { message: "Name must be 1 to 30 characters" });
        }
      }
      if ((signUp || body.colour !== undefined) && !isMemberColour(body.colour)) {
        throw new APIError("BAD_REQUEST", { message: "Colour must be one of the member colours" });
      }
      if (signUp) {
        const headers = ctx.headers ?? ctx.request?.headers ?? new Headers();
        const limited = await hit("signup:" + hashIp(clientIp(headers)), SIGN_UPS_PER_IP_PER_DAY, DAY_SEC);
        if (!limited.ok) {
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-ups from this address; try again tomorrow" });
        }
      }
      // Store the trimmed name.
      return name === undefined ? undefined : { context: { body: { ...body, name } } };
    }),
  },
  plugins: [bearer()],
});

/**
 * The session for a request carrying a cookie or `Authorization: Bearer`. Takes a Fetch `Request`
 * (route handlers) or a Node `IncomingMessage` (the WebSocket sync server). Browsers cannot set
 * headers on a WebSocket, so the sync provider passes its token as `token`.
 */
export async function getSessionFromRequest(req: Request | IncomingMessage, token?: string) {
  const headers = new Headers(toHeaders(req));
  if (token) headers.set("authorization", `Bearer ${token}`);
  return auth.api.getSession({ headers });
}

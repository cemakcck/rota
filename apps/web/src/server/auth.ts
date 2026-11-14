import type { IncomingMessage } from "node:http";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import { db } from "./db/client";
import * as schema from "./db/schema";
import { sendEmail } from "./email";
import { clientIp, hashIp, toHeaders } from "./ipHash";
import { hit } from "./rateLimit";
import { acceptEmailInvites } from "./signUpHooks";

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
      void sendEmail({
        to: user.email,
        subject: "Reset your Rota password",
        text: `Reset your password: ${url}\n\nIf you did not ask for this, ignore this email.`,
        html: `<p><a href="${url}">Reset your Rota password</a></p><p>If you did not ask for this, ignore this email.</p>`,
      }).catch((e) => console.error("[email] password reset failed", e));
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
      if (ctx.path !== "/sign-up/email") return;
      const body = (ctx.body ?? {}) as { name?: unknown; colour?: unknown };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 1 || name.length > 30) {
        throw new APIError("BAD_REQUEST", { message: "Name must be 1 to 30 characters" });
      }
      if (typeof body.colour !== "string" || body.colour.length < 1 || body.colour.length > 32) {
        throw new APIError("BAD_REQUEST", { message: "Colour is required" });
      }
      const headers = ctx.headers ?? ctx.request?.headers ?? new Headers();
      const limited = await hit("signup:" + hashIp(clientIp(headers)), SIGN_UPS_PER_IP_PER_DAY, DAY_SEC);
      if (!limited.ok) {
        throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-ups from this address; try again tomorrow" });
      }
    }),
  },
  databaseHooks: {
    user: { create: { after: async (user) => acceptEmailInvites(user) } },
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

import { randomUUID } from "node:crypto";
import { MEMBER_COLOURS } from "@rota/trip";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { user } from "@/server/db/schema";

export const ORIGIN = "http://localhost:3400";
const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

export type TestUser = { id: string; email: string; name: string; token: string; cookie: string };

/** Signs a user up through Better Auth; the result carries a bearer token for `call` and the browser's session cookie. */
export async function signUpUser(over: { email?: string; name?: string } = {}): Promise<TestUser> {
  const email = over.email ?? `${randomUUID()}@test.rota`;
  const name = over.name ?? "Ayşe";
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": randomIp() },
      body: JSON.stringify({ email, password: "correct-horse-1", name, colour: MEMBER_COLOURS[0] }),
    }),
  );
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { id: body.user.id, email, name, token: res.headers.get("set-auth-token")!, cookie };
}

/** A user row without an account or session: enough to be a member. */
export async function insertUser(name = "Filler"): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({ id, name, email: `${id}@test.rota`, colour: MEMBER_COLOURS[1] });
  return id;
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export function call(
  handler: Handler,
  method: string,
  as: TestUser | null,
  opts: { params?: Record<string, string>; body?: unknown; path?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (as) headers.authorization = `Bearer ${as.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${ORIGIN}${opts.path ?? "/api/x"}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return handler(req, { params: Promise.resolve(opts.params ?? {}) });
}

export const NEW_TRIP = { name: "Lisbon", startDate: "2027-05-01", days: 3, locale: "en" } as const;

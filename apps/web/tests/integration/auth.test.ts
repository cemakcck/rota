import { hashIp } from "@/server/ipHash";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { MEMBER_COLOURS } from "@rota/trip";
import { POST as authRoute } from "@/app/api/auth/[...all]/route";
import { auth, getSessionFromRequest } from "@/server/auth";
import { db } from "@/server/db/client";
import { session } from "@/server/db/schema";
import * as email from "@/server/email";

const ORIGIN = "http://localhost:3400";
const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const uniqueEmail = () => `${randomUUID()}@test.rota`;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": randomIp(), ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const signUp = (over: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  post("/sign-up/email", { email: uniqueEmail(), password: "correct-horse-1", name: "Ayşe", colour: MEMBER_COLOURS[0], ...over }, headers);

describe("accounts", () => {
  it("sign up, sign in and read the session by cookie and by bearer token", async () => {
    const email = uniqueEmail();
    expect((await signUp({ email })).status).toBe(200);

    const signIn = await post("/sign-in/email", { email, password: "correct-horse-1" });
    expect(signIn.status).toBe(200);
    const token = signIn.headers.get("set-auth-token");
    expect(token).toBeTruthy();
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    const byCookie = await getSessionFromRequest(new Request(`${ORIGIN}/x`, { headers: { cookie } }));
    expect(byCookie?.user.email).toBe(email);

    const byBearer = await getSessionFromRequest(new Request(`${ORIGIN}/x`, { headers: { authorization: `Bearer ${token}` } }));
    expect(byBearer?.user.email).toBe(email);

    const node = { headers: { authorization: `Bearer ${token}` }, socket: {} } as unknown as IncomingMessage;
    expect((await getSessionFromRequest(node))?.user.email).toBe(email);
    expect((await getSessionFromRequest(new Request(`${ORIGIN}/x`)))).toBeNull();
    expect((await getSessionFromRequest({ headers: {}, socket: {} } as unknown as IncomingMessage, token!))?.user.email).toBe(email);
  });

  it("sign-up requires a name of 1–30 chars and stores the chosen colour", async () => {
    expect((await signUp({ name: "" })).status).toBe(400);
    expect((await signUp({ name: "   " })).status).toBe(400);
    expect((await signUp({ name: "x".repeat(31) })).status).toBe(400);
    expect((await signUp({ colour: undefined })).status).toBe(400);
    expect((await signUp({ colour: "#000000" })).status).toBe(400);
    expect((await signUp({ colour: "red" })).status).toBe(400);

    const res = await signUp({ name: "x".repeat(30), colour: MEMBER_COLOURS[5] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { colour: string; isDemo: boolean } };
    expect(body.user.colour).toBe(MEMBER_COLOURS[5]);
    expect(body.user.isDemo).toBe(false);
  });

  it("the 21st sign-up from one IP in a day is refused", async () => {
    const headers = { "x-forwarded-for": randomIp() };
    for (let i = 0; i < 20; i++) expect((await signUp({}, headers)).status).toBe(200);
    expect((await signUp({}, headers)).status).toBe(429);
    expect((await signUp({}, { "x-forwarded-for": randomIp() })).status).toBe(200);
  });

  it("update-user applies the same name and colour rules and stores the trimmed name", async () => {
    const email = uniqueEmail();
    const signIn = async () => {
      await signUp({ email });
      const res = await post("/sign-in/email", { email, password: "correct-horse-1" });
      return { Authorization: `Bearer ${res.headers.get("set-auth-token")}` };
    };
    const bearer = await signIn();
    expect((await post("/update-user", { colour: "#000000" }, bearer)).status).toBe(400);
    expect((await post("/update-user", { name: "x".repeat(31) }, bearer)).status).toBe(400);
    expect((await post("/update-user", { name: "   " }, bearer)).status).toBe(400);
    expect((await post("/update-user", { name: "  Mehmet  ", colour: MEMBER_COLOURS[3] }, bearer)).status).toBe(200);
    const session = await getSessionFromRequest(new Request(`${ORIGIN}/x`, { headers: bearer }));
    expect(session?.user.name).toBe("Mehmet");
    expect((session?.user as { colour?: string }).colour).toBe(MEMBER_COLOURS[3]);
  });

  it("sign-up stores the trimmed name", async () => {
    const res = await signUp({ name: "  Ayşe  " });
    expect(((await res.json()) as { user: { name: string } }).user.name).toBe("Ayşe");
  });
});

describe("password reset email", () => {
  it.each([
    ["en", "Reset your Rota password", "Reset your password: "],
    ["tr", "Rota şifrenizi sıfırlayın", "Şifrenizi sıfırlayın: "],
  ])("is written in the language of the page that asked for it (%s)", async (locale, subject, text) => {
    const sent: email.EmailMessage[] = [];
    const spy = vi.spyOn(email, "sendEmail").mockImplementation(async (m) => {
      sent.push(m);
    });
    try {
      const address = uniqueEmail();
      expect((await signUp({ email: address })).status).toBe(200);
      const res = await post("/request-password-reset", { email: address, redirectTo: `${ORIGIN}/${locale}/reset` });
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0].subject).toBe(subject);
      expect(sent[0].text.startsWith(text + `${ORIGIN}/api/auth/reset-password/`)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the client IP Better Auth sees (its rate limiter and sessions)", () => {
  // Sessions keep only the HMAC hash of the client IP (spec: IPs are stored only as hashes).
  /** Signs up through the app's auth route and returns the IP Better Auth resolved for the request. */
  async function resolvedIp(headers: Record<string, string>): Promise<string | null> {
    const res = await authRoute(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
        body: JSON.stringify({ email: uniqueEmail(), password: "correct-horse-1", name: "Ayşe", colour: MEMBER_COLOURS[0] }),
      }),
    );
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: { id: string } };
    const [row] = await db.select({ ip: session.ipAddress }).from(session).where(eq(session.userId, user.id));
    return row.ip;
  }

  it("is the trusted end of a multi-entry X-Forwarded-For, like clientIp (one proxy hop by default)", async () => {
    const client = randomIp();
    expect(await resolvedIp({ "x-forwarded-for": `203.0.113.9, ${client}` })).toBe(hashIp(client));
  });

  it("follows TRUSTED_PROXY_HOPS", async () => {
    const client = randomIp();
    const before = process.env.TRUSTED_PROXY_HOPS;
    process.env.TRUSTED_PROXY_HOPS = "2";
    try {
      expect(await resolvedIp({ "x-forwarded-for": `203.0.113.9, ${client}, 10.0.0.1` })).toBe(hashIp(client));
    } finally {
      if (before === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = before;
    }
  });

  it("cannot be forged with the internal header", async () => {
    const client = randomIp();
    expect(await resolvedIp({ "x-forwarded-for": client, "x-rota-client-ip": "198.51.100.7" })).toBe(hashIp(client));
  });
});

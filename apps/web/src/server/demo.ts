import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { MEMBER_COLOURS, seedDemoTrip, type Locale, type MemberView } from "@rota/trip";
import { auth } from "./auth";
import { db } from "./db/client";
import { tripMembers, trips, user } from "./db/schema";
import { HttpError } from "./httpError";
import { hashIp } from "./ipHash";
import { hit } from "./rateLimit";
import { addMember, createTrip, deleteTrip } from "./trips/repo";

const DEMO_STARTS_PER_IP_PER_DAY = 20;
const DAY_SEC = 86_400;

/**
 * Demo friends use this email domain. It is how housekeeping tells a friend from a visitor: friends
 * are never deleted on their own, only together with the visitor whose trip they belong to.
 */
export const DEMO_FRIEND_DOMAIN = "friend.demo.invalid";
const DEMO_VISITOR_DOMAIN = "visitor.demo.invalid";

const ANIMALS: Record<Locale, string[]> = {
  en: ["Otter", "Heron", "Fox", "Lynx", "Badger", "Puffin", "Gecko", "Marmot"],
  tr: ["Su Samuru", "Balıkçıl", "Tilki", "Vaşak", "Porsuk", "Deniz Papağanı", "Keçi", "Dağ Sıçanı"],
};
const pick = <T>(items: readonly T[]): T => items[randomBytes(1)[0] % items.length];

/** Today's calendar date in Istanbul, whatever zone the server runs in. */
export function istanbulToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Creates a demo user straight through Better Auth's internal adapter (no endpoint, so no sign-up
 * hooks or limits). The credential is a fresh random password, hashed with Better Auth's own
 * hasher; only `signIn` below ever knows it, and it is discarded.
 */
async function createDemoUser(name: string, colour: string, kind: "visitor" | "friend"): Promise<{ member: MemberView; email: string; password: string }> {
  const ctx = await auth.$context;
  const email = `${kind === "friend" ? name.toLowerCase() : "guest"}-${randomUUID()}@${kind === "friend" ? DEMO_FRIEND_DOMAIN : DEMO_VISITOR_DOMAIN}`;
  const password = randomBytes(32).toString("hex");
  const created = await ctx.internalAdapter.createUser({ name, email, emailVerified: true, colour, isDemo: true }, { method: "demo" });
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: await ctx.password.hash(password),
  });
  return { member: { id: created.id, name, colour }, email, password };
}

/**
 * Starts a demo: three demo users, a seeded trip the visitor owns, and the visitor's session.
 * The `Set-Cookie` value comes from Better Auth's own sign-in, so it is signed and attributed
 * exactly as Better Auth expects when it reads the cookie back.
 */
export async function startDemo(input: { ip: string; locale: Locale }): Promise<{ sessionCookie: string; tripId: string }> {
  const limited = await hit("demo:" + hashIp(input.ip), DEMO_STARTS_PER_IP_PER_DAY, DAY_SEC);
  if (!limited.ok) throw new HttpError(429, "rate_limited");

  const created: string[] = [];
  let tripId: string | undefined;
  try {
    const guest = input.locale === "tr" ? "Misafir" : "Guest";
    const make = async (...args: Parameters<typeof createDemoUser>) => {
      const made = await createDemoUser(...args);
      created.push(made.member.id);
      return made;
    };
    const visitor = await make(`${guest} ${pick(ANIMALS[input.locale])}`, MEMBER_COLOURS[5], "visitor");
    const deniz = await make("Deniz", MEMBER_COLOURS[1], "friend");
    const selin = await make("Selin", MEMBER_COLOURS[4], "friend");

    tripId = await createTrip({
      ownerId: visitor.member.id,
      name: "",
      startDate: "",
      days: 3,
      destination: null,
      isDemo: true,
      locale: input.locale,
      build: (doc) => seedDemoTrip(doc, { today: istanbulToday(), locale: input.locale, owner: visitor.member, deniz: deniz.member, selin: selin.member }),
    });
    await addMember(tripId, deniz.member.id, "member");
    await addMember(tripId, selin.member.id, "member");

    const { headers } = await auth.api.signInEmail({ body: { email: visitor.email, password: visitor.password }, returnHeaders: true });
    const cookieName = (await auth.$context).authCookies.sessionToken.name;
    const sessionCookie = headers.getSetCookie().find((c) => c.startsWith(`${cookieName}=`));
    if (!sessionCookie) throw new Error("Better Auth did not set a session cookie");
    return { sessionCookie, tripId };
  } catch (err) {
    // Best effort: never leave half a demo behind. Cleanup's orphan sweep catches whatever this misses.
    await discard(created, tripId).catch((e) => console.error("[demo] could not discard a failed start", e));
    throw err;
  }
}

/** Removes the users (and trip) of a start that failed; the trip is tombstoned first as it owns the visitor. */
async function discard(userIds: string[], tripId: string | undefined): Promise<void> {
  if (tripId) await deleteTrip(tripId);
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds));
}

/**
 * A bearer session for Deniz, so the browser's scripted friend can edit the trip as him. Only the
 * owner of a demo trip may ask; everyone else gets the same 404 as for a trip that does not exist.
 */
export async function friendToken(tripId: string, requesterId: string): Promise<{ token: string; user: MemberView }> {
  const [trip] = await db.select({ ownerId: trips.ownerId, isDemo: trips.isDemo }).from(trips).where(eq(trips.id, tripId));
  if (!trip || !trip.isDemo || trip.ownerId !== requesterId) throw new HttpError(404, "not_found");
  const [deniz] = await db
    .select({ id: user.id, name: user.name, colour: user.colour, email: user.email })
    .from(tripMembers)
    .innerJoin(user, eq(user.id, tripMembers.userId))
    .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.removedAt), eq(user.name, "Deniz"), eq(user.isDemo, true)));
  if (!deniz?.email.endsWith(`@${DEMO_FRIEND_DOMAIN}`)) throw new HttpError(404, "not_found");
  const session = await (await auth.$context).internalAdapter.createSession(deniz.id);
  return { token: session.token, user: { id: deniz.id, name: deniz.name, colour: deniz.colour } };
}

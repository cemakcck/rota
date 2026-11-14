import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import * as Y from "yjs";
import { readTrip } from "@rota/trip";
import { db } from "../db/client";
import { tripInvites, tripMembers, trips, user } from "../db/schema";
import { sendEmail } from "../email";
import { HttpError } from "../httpError";
import { hashIp } from "../ipHash";
import { hit } from "../rateLimit";
import { loadState } from "./docStore";
import { addMember, listMembers } from "./repo";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_LENGTH = 43; // 62^43 > 2^256, so 32 random bytes always fit

/** 32 random bytes as a fixed-width base62 string. */
function newToken(): string {
  let value = BigInt("0x" + randomBytes(32).toString("hex"));
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new join link. Any active link for the trip is revoked in the same step (regenerate). */
export async function createLinkInvite(tripId: string, byUserId: string, token: string = newToken()): Promise<{ token: string }> {
  const hash = hashToken(token);
  await db.transaction(async (tx) => {
    await tx
      .update(tripInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.kind, "link"), isNull(tripInvites.revokedAt), ne(tripInvites.tokenHash, hash)));
    await tx
      .insert(tripInvites)
      .values({ tripId, kind: "link", tokenHash: hash, createdBy: byUserId })
      .onConflictDoNothing();
  });
  return { token };
}

/** Revokes one invite of the given trip. False when there is no such active invite. */
export async function revokeInvite(tripId: string, inviteId: string): Promise<boolean> {
  const rows = await db
    .update(tripInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(tripInvites.id, inviteId), eq(tripInvites.tripId, tripId), isNull(tripInvites.revokedAt)))
    .returning({ id: tripInvites.id });
  return rows.length > 0;
}

/**
 * Joins the user to the trip behind a token: an active join link (reusable), or the single-use token
 * of an email invite, which is used up here. Joining twice is fine; a used email token keeps working
 * for the member it brought in (a reload, a repeated request) and for no one else.
 */
export async function acceptLink(token: string, userId: string): Promise<{ tripId: string }> {
  const [invite] = await db
    .select({ id: tripInvites.id, tripId: tripInvites.tripId, kind: tripInvites.kind, revokedAt: tripInvites.revokedAt })
    .from(tripInvites)
    .where(eq(tripInvites.tokenHash, hashToken(token)));
  if (!invite) throw new HttpError(404, "not_found");
  // A link never brings back someone the owner removed; only an explicit owner action does.
  const [membership] = await db
    .select({ removedAt: tripMembers.removedAt })
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, invite.tripId), eq(tripMembers.userId, userId)));
  if (membership?.removedAt) throw new HttpError(404, "not_found");
  if (invite.revokedAt) {
    if (invite.kind === "email" && membership) return { tripId: invite.tripId };
    throw new HttpError(404, "not_found");
  }
  if (invite.kind === "email") {
    // Use the token up first, so two people racing with one forwarded email cannot both join.
    const used = await db
      .update(tripInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(tripInvites.id, invite.id), isNull(tripInvites.revokedAt)))
      .returning({ id: tripInvites.id });
    if (used.length === 0) throw new HttpError(404, "not_found");
    try {
      await addMember(invite.tripId, userId, "member");
    } catch (err) {
      // A full trip: the invite stays usable for when there is room.
      await db.update(tripInvites).set({ revokedAt: null }).where(eq(tripInvites.id, invite.id));
      throw err;
    }
    return { tripId: invite.tripId };
  }
  await addMember(invite.tripId, userId, "member");
  return { tripId: invite.tripId };
}

export async function listInvites(tripId: string) {
  return db
    .select({ id: tripInvites.id, kind: tripInvites.kind, email: tripInvites.email, createdAt: tripInvites.createdAt })
    .from(tripInvites)
    .where(and(eq(tripInvites.tripId, tripId), isNull(tripInvites.revokedAt)))
    .orderBy(asc(tripInvites.createdAt));
}

// ---- Email invites -----------------------------------------------------------------------

const baseUrl = () => (process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_URL ?? "http://localhost:3400").replace(/\/$/, "");
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** English only for now; the trip's locale still picks the link's language prefix. */
async function sendInviteEmail(opts: { to: string; tripName: string; inviter: string; url: string; newUser: boolean }) {
  const { to, tripName, inviter, url, newUser } = opts;
  const action = newUser ? "Create your account to join" : "Open the trip";
  try {
    await sendEmail({
      to,
      subject: `${inviter} invited you to ${tripName} on Rota`,
      text: `${inviter} invited you to plan "${tripName}" together on Rota.\n\n${action}: ${url}`,
      html: `<p>${escapeHtml(inviter)} invited you to plan &ldquo;${escapeHtml(tripName)}&rdquo; together on Rota.</p><p><a href="${url}">${action}</a></p>`,
    });
  } catch (err) {
    // The invite itself is recorded; a mail failure must not undo it.
    console.error("[invite] email failed", err);
  }
}

async function tripLocale(tripId: string): Promise<string> {
  const state = await loadState(tripId);
  if (!state) return "en";
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return readTrip(doc).locale;
}

const EMAIL_INVITES_PER_USER_PER_DAY = 20;
// Higher than per user: people behind one NAT (a household, an office) share an address.
const EMAIL_INVITES_PER_IP_PER_DAY = 40;
const DAY_SEC = 86_400;

/**
 * Every email invite may send an email to an address the inviter chose, so it is counted per user and
 * per IP; over either limit it is a 429. Keeps a signed-up user from using Rota to send spam.
 */
export async function limitEmailInvites(userId: string, ip: string): Promise<void> {
  const byUser = await hit(`invite:user:${userId}`, EMAIL_INVITES_PER_USER_PER_DAY, DAY_SEC);
  const byIp = await hit(`invite:ip:${hashIp(ip)}`, EMAIL_INVITES_PER_IP_PER_DAY, DAY_SEC);
  if (!byUser.ok || !byIp.ok) throw new HttpError(429, "rate_limited");
}

/** Existing account: added now and told by email. Otherwise a pending invite plus a sign-up email. */
export async function inviteEmail(tripId: string, rawEmail: string, byUserId: string): Promise<{ status: "added" | "already_member" | "pending" }> {
  const email = rawEmail.trim().toLowerCase();
  const [trip] = await db.select({ name: trips.name }).from(trips).where(eq(trips.id, tripId));
  if (!trip) throw new HttpError(404, "not_found");
  const [inviter] = await db.select({ name: user.name }).from(user).where(eq(user.id, byUserId));
  const inviterName = inviter?.name ?? "A friend";
  const locale = await tripLocale(tripId);
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));

  if (existing) {
    const members = await listMembers(tripId);
    if (members.some((m) => m.id === existing.id)) return { status: "already_member" };
    await addMember(tripId, existing.id, "member");
    await sendInviteEmail({ to: email, tripName: trip.name, inviter: inviterName, url: `${baseUrl()}/${locale}/t/${tripId}`, newUser: false });
    return { status: "added" };
  }

  const [pending] = await db
    .select({ id: tripInvites.id })
    .from(tripInvites)
    .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.kind, "email"), eq(tripInvites.email, email), isNull(tripInvites.revokedAt)));
  // Already invited: no second email, so repeating the invite cannot be used to flood an inbox.
  if (pending) return { status: "pending" };
  // The address is not verified at sign-up, so the address alone must not join: the email carries a
  // single-use token (only its hash is stored), and the sign-up page sends the new account on to
  // /invite/<token>, which joins. With an account already, "Sign in" on that page keeps the same `next`.
  const token = newToken();
  await db.insert(tripInvites).values({ tripId, kind: "email", email, tokenHash: hashToken(token), createdBy: byUserId });
  const next = encodeURIComponent(`/invite/${token}`);
  await sendInviteEmail({
    to: email,
    tripName: trip.name,
    inviter: inviterName,
    url: `${baseUrl()}/${locale}/sign-up?email=${encodeURIComponent(email)}&next=${next}`,
    newUser: true,
  });
  return { status: "pending" };
}

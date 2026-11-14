"use client";

import { useEffect } from "react";
import { createAuthClient } from "better-auth/react";
import type { MemberView } from "@rota/trip";

// Friend windows (spec §11) are a second person in the same browser: the cookie belongs to the
// visitor, so the friend's requests and sync connection carry a bearer token kept in this window's
// sessionStorage instead.

const FRIEND_KEY = "rota.friend";

export type FriendSession = { token: string; user: MemberView };

/** The friend window's bearer session, or null in a normal window (or if what is stored is unusable). */
export function friendSession(): FriendSession | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(FRIEND_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const { token, user } = value as Record<string, unknown>;
    if (typeof token !== "string" || !token || typeof user !== "object" || user === null) return null;
    const { id, name, colour } = user as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string" || typeof colour !== "string") return null;
    return { token, user: { id, name, colour } };
  } catch {
    return null;
  }
}

/** True in a friend window: opened with `?friend=1`, or already holding a friend session. */
export function isFriendWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("friend") === "1") return true;
  try {
    return window.sessionStorage.getItem(FRIEND_KEY) !== null;
  } catch {
    return false;
  }
}

/** The friend's bearer header; none in a normal window, where the session cookie is sent. */
export function authHeaders(): Record<string, string> {
  const friend = friendSession();
  return friend ? { Authorization: `Bearer ${friend.token}` } : {};
}

/**
 * The sync server's `token`: the friend's bearer token, else "cookie" for the upgrade request's cookie.
 * Null in a friend window whose token has not arrived: the cookie there is the visitor's.
 */
export function syncToken(): string | null {
  const friend = friendSession();
  if (friend) return friend.token;
  return isFriendWindow() ? null : "cookie";
}

/** `fetch` for this app's API, with the friend's bearer header when there is one. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(authHeaders())) headers.set(name, value);
  return fetch(path, { ...init, headers });
}

export const authClient = createAuthClient({
  fetchOptions: { auth: { type: "Bearer", token: () => friendSession()?.token } },
});

// The last signed-in user is remembered on the device, so a cookie user still has an id offline
// (their edits are attributed to them, never to "").
const USER_KEY = "rota.user";

export type SessionState = { data: { user: { id: string; name: string } } | null; isPending: boolean; error: unknown };

export function rememberedUser(): MemberView | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(USER_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const { id, name, colour } = value as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof name !== "string" || typeof colour !== "string") return null;
    return { id, name, colour };
  } catch {
    return null;
  }
}

/** Forgets the remembered user; the sign-out action calls it. */
export function forgetUser(): void {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // Storage blocked: nothing was remembered.
  }
}

/** Remembers the session's user, and forgets it once the session says nobody is signed in. */
export function trackSessionUser(session: SessionState): void {
  try {
    const user = session.data?.user;
    if (user) {
      const colour = (user as { colour?: unknown }).colour;
      localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, name: user.name, colour: typeof colour === "string" ? colour : "" }));
    } else if (!session.isPending && !session.error) {
      forgetUser();
    }
  } catch {
    // Storage blocked: the id is then only known while the session is.
  }
}

/** Who is editing: the friend in a friend window, else the session's or the remembered user. Null when unknown. */
export function resolveUserId(session: SessionState): string | null {
  if (isFriendWindow()) return friendSession()?.user.id ?? null;
  return session.data?.user.id ?? rememberedUser()?.id ?? null;
}

/** The current user's id, or null when it is not known (the UI then blocks edits). */
export function useUserId(): string | null {
  const session = authClient.useSession();
  useEffect(() => trackSessionUser(session), [session]);
  return resolveUserId(session);
}

/**
 * The current user for pages that need one. `signedOut` is true only once the session has settled with
 * nobody signed in and nobody remembered on the device: a failed session fetch (offline) is not signed out.
 */
export function useUserState(): { userId: string | null; signedOut: boolean } {
  const session = authClient.useSession();
  useEffect(() => trackSessionUser(session), [session]);
  const userId = resolveUserId(session);
  return { userId, signedOut: userId === null && !session.isPending && !session.error };
}

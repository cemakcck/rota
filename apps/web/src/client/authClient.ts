"use client";

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

/** The sync server's `token`: the friend's bearer token, else "cookie" for the upgrade request's cookie. */
export function syncToken(): string {
  return friendSession()?.token ?? "cookie";
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

/** The signed-in user's id ("" until known). A friend window knows it without asking the server. */
export function useUserId(): string {
  const session = authClient.useSession();
  return friendSession()?.user.id ?? session.data?.user.id ?? "";
}

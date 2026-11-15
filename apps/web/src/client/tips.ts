"use client";

import { apiFetch } from "./authClient";

// The first-time tour (spec §4) is remembered per user: on the server (`user.tips_seen_at`, any device)
// and on this device, so it is known offline and before the server answers. "pending" marks a tour seen
// here whose server write has not gone through yet; it is retried the next time a trip opens.

const PATH = "/api/profile/tips";
const key = (userId: string) => `rota.tipsSeen.${userId}`;

export type SeenHere = "seen" | "pending" | null;

/** What this device knows: seen (and saved on the server), seen but not saved yet, or nothing. */
export function tipsSeenHere(userId: string): SeenHere {
  try {
    const value = localStorage.getItem(key(userId));
    return value === "seen" || value === "pending" ? value : null;
  } catch {
    return null;
  }
}

function remember(userId: string, value: SeenHere): void {
  try {
    if (value === null) localStorage.removeItem(key(userId));
    else localStorage.setItem(key(userId), value);
  } catch {
    // Storage blocked: the server's flag alone.
  }
}

/** Forgets that this device saw the tour (the server says it was reset: "Show tips again" elsewhere). */
export function forgetTipsSeenHere(userId: string): void {
  remember(userId, null);
}

// A friend window (spec §11) shows the tour only on an open after the friend's first edit there.
const editedKey = (userId: string) => `rota.tipsEdited.${userId}`;

/** Whether this person has edited a trip in a friend window on this device. */
export function friendEditedHere(userId: string): boolean {
  try {
    return localStorage.getItem(editedKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function rememberFriendEdited(userId: string): void {
  try {
    localStorage.setItem(editedKey(userId), "1");
  } catch {
    // Storage blocked: the tour stays away in friend windows.
  }
}

/** Whether the server says this user has seen the tour; null when it cannot be asked (offline). */
export async function tipsSeenOnServer(userId: string): Promise<boolean | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  try {
    const res = await apiFetch(PATH);
    if (!res.ok) return null;
    const { seen } = (await res.json()) as { seen: unknown };
    if (typeof seen !== "boolean") return null;
    if (seen) remember(userId, "seen");
    return seen;
  } catch {
    return null;
  }
}

/** Marks the tour seen: on this device at once, then on the server (left pending if that fails). */
export async function markTipsSeen(userId: string): Promise<void> {
  remember(userId, "pending");
  try {
    const res = await apiFetch(PATH, { method: "PUT" });
    if (res.ok && tipsSeenHere(userId) === "pending") remember(userId, "seen");
  } catch {
    // Offline: still pending, retried next time.
  }
}

/** "Show tips again": forgotten on the server, then here (nothing changes when the server says no or cannot be reached). */
export async function showTipsAgain(userId: string): Promise<"ok" | "failed" | "offline"> {
  try {
    const res = await apiFetch(PATH, { method: "DELETE" });
    if (!res.ok) return "failed";
  } catch {
    return "offline";
  }
  remember(userId, null);
  return "ok";
}

import type { MemberView } from "@rota/trip";
import { forgetPending } from "./sync/pending";

// My trips must open offline (spec §10), so the last list from the server is kept on the device,
// along with which trips have been synced into IndexedDB at least once (the "offline copy" badge).
// Everything stored per device is per user: in the demo one browser holds two people (the visitor and
// the friend window), and neither may see, send or forget the other's copy.

export type CachedTrip = {
  id: string;
  name: string;
  startDate: string;
  days: number;
  destination: unknown;
  isDemo: boolean;
  role: "owner" | "member";
  members: MemberView[];
};

const tripsKey = (userId: string) => `rota.myTrips.${userId}`;
const offlineKey = (userId: string) => `rota.offlineTrips.${userId}`;

/** The IndexedDB database holding the user's copy of a trip on this device. */
export const tripDatabaseName = (tripId: string, userId: string) => `rota-trip-${tripId}-${userId}`;

function read(key: string): unknown[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the cache is a convenience, the trips themselves are in IndexedDB.
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function isCachedTrip(v: unknown): v is CachedTrip {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.startDate === "string" &&
    typeof v.days === "number" &&
    typeof v.isDemo === "boolean" &&
    (v.role === "owner" || v.role === "member") &&
    Array.isArray(v.members) &&
    v.members.every((m) => isRecord(m) && typeof m.id === "string" && typeof m.name === "string" && typeof m.colour === "string")
  );
}

export function cacheTrips(userId: string, list: CachedTrip[]): void {
  write(tripsKey(userId), list);
}

/** The user's last cached list; entries that are not trips are dropped, and unreadable storage is an empty list. */
export function cachedTrips(userId: string): CachedTrip[] {
  return read(tripsKey(userId)).filter(isCachedTrip);
}

const offlineIds = (userId: string) => read(offlineKey(userId)).filter((v): v is string => typeof v === "string");

export function hasOfflineCopy(tripId: string, userId: string): boolean {
  return offlineIds(userId).includes(tripId);
}

/** Records that the user's copy of the trip has synced into this device's IndexedDB at least once. */
export function markOfflineCopy(tripId: string, userId: string): void {
  const ids = offlineIds(userId);
  if (!ids.includes(tripId)) write(offlineKey(userId), [...ids, tripId]);
}

/** Drops the user's copy of the trip from this device: its database, offline mark, pending changes and cached entry. */
export async function forgetTrip(tripId: string, userId: string): Promise<void> {
  forgetPending(tripId, userId);
  write(offlineKey(userId), offlineIds(userId).filter((id) => id !== tripId));
  write(tripsKey(userId), cachedTrips(userId).filter((t) => t.id !== tripId));
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(tripDatabaseName(tripId, userId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // Another tab still has it open; it is deleted once that tab lets go.
    request.onblocked = () => resolve();
  });
}

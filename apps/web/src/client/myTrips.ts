import type { MemberView } from "@rota/trip";
import { forgetPending } from "./sync/pending";

// My trips must open offline (spec §10), so the last list from the server is kept on the device,
// along with which trips have been synced into IndexedDB at least once (the "offline copy" badge).

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

const TRIPS_KEY = "rota.myTrips";
const OFFLINE_KEY = "rota.offlineTrips";

/** The IndexedDB database holding a trip's document on this device. */
export const tripDatabaseName = (tripId: string) => `rota-trip-${tripId}`;

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

export function cacheTrips(list: CachedTrip[]): void {
  write(TRIPS_KEY, list);
}

/** The last cached list; entries that are not trips are dropped, and unreadable storage is an empty list. */
export function cachedTrips(): CachedTrip[] {
  return read(TRIPS_KEY).filter(isCachedTrip);
}

const offlineIds = () => read(OFFLINE_KEY).filter((v): v is string => typeof v === "string");

export function hasOfflineCopy(tripId: string): boolean {
  return offlineIds().includes(tripId);
}

/** Records that the trip has synced into this device's IndexedDB at least once. */
export function markOfflineCopy(tripId: string): void {
  const ids = offlineIds();
  if (!ids.includes(tripId)) write(OFFLINE_KEY, [...ids, tripId]);
}

/** Drops the trip from this device: its IndexedDB database, its offline mark, pending changes and cached entry. */
export async function forgetTrip(tripId: string): Promise<void> {
  forgetPending(tripId);
  write(OFFLINE_KEY, offlineIds().filter((id) => id !== tripId));
  write(TRIPS_KEY, cachedTrips().filter((t) => t.id !== tripId));
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(tripDatabaseName(tripId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // Another tab still has it open; it is deleted once that tab lets go.
    request.onblocked = () => resolve();
  });
}

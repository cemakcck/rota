import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { newTripId } from "@rota/trip";
import { pendingCount, recordPending } from "@/client/sync/pending";
import { cacheTrips, cachedTrips, forgetTrip, hasOfflineCopy, markOfflineCopy, type CachedTrip } from "@/client/myTrips";

const trip = (id: string, name: string): CachedTrip => ({
  id,
  name,
  startDate: "2026-12-04",
  days: 3,
  destination: null,
  isDemo: false,
  role: "owner",
  members: [{ id: "u1", name: "Ada", colour: "#2563eb" }],
});

async function databaseNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? "");
}

const user = "u-ada";

afterEach(() => localStorage.clear());

describe("my trips cache", () => {
  it("round-trips the trip list", () => {
    const list = [trip(newTripId(), "Istanbul"), trip(newTripId(), "Lisbon")];
    cacheTrips(user, list);
    expect(cachedTrips(user)).toEqual(list);
    expect(cachedTrips("u-deniz")).toEqual([]);
  });

  it("cachedTrips survives corrupted storage", () => {
    localStorage.setItem(`rota.myTrips.${user}`, "{not json");
    expect(cachedTrips(user)).toEqual([]);
    localStorage.setItem(`rota.myTrips.${user}`, JSON.stringify({ trips: "nope" }));
    expect(cachedTrips(user)).toEqual([]);
    localStorage.setItem(`rota.myTrips.${user}`, JSON.stringify([trip(newTripId(), "ok"), { id: 7 }, null]));
    expect(cachedTrips(user).map((t) => t.name)).toEqual(["ok"]);
    localStorage.setItem(`rota.offlineTrips.${user}`, "[[[");
    expect(hasOfflineCopy(newTripId(), user)).toBe(false);
  });

  it("is per user: another person's list, offline copies and trip copy are untouched", async () => {
    const id = newTripId();
    cacheTrips("u-deniz", [trip(id, "Deniz's Istanbul")]);
    markOfflineCopy(id, "u-deniz");
    const doc = new Y.Doc();
    doc.getMap("meta").set("name", "Istanbul");
    const idb = new IndexeddbPersistence(`rota-trip-${id}-u-deniz`, doc);
    await idb.whenSynced;
    await idb.destroy();
    expect(cachedTrips(user)).toEqual([]);
    expect(hasOfflineCopy(id, user)).toBe(false);

    await forgetTrip(id, user);

    expect(await databaseNames()).toContain(`rota-trip-${id}-u-deniz`);
    expect(hasOfflineCopy(id, "u-deniz")).toBe(true);
    expect(cachedTrips("u-deniz").map((t) => t.id)).toEqual([id]);
  });

  it("remembers which trips have an offline copy", () => {
    const id = newTripId();
    expect(hasOfflineCopy(id, user)).toBe(false);
    markOfflineCopy(id, user);
    markOfflineCopy(id, user);
    expect(hasOfflineCopy(id, user)).toBe(true);
  });

  it("forgetTrip deletes the trip's IndexedDB database", async () => {
    const id = newTripId();
    const other = newTripId();
    for (const tripId of [id, other]) {
      const doc = new Y.Doc();
      doc.getMap("meta").set("name", "Istanbul");
      const idb = new IndexeddbPersistence(`rota-trip-${tripId}-${user}`, doc);
      await idb.whenSynced;
      await idb.destroy();
    }
    cacheTrips(user, [trip(id, "Istanbul"), trip(other, "Lisbon")]);
    markOfflineCopy(id, user);
    recordPending(id, user, "tab-a", ["meta"], Date.now());
    recordPending(other, user, "tab-a", ["meta"], Date.now());
    expect(await databaseNames()).toContain(`rota-trip-${id}-${user}`);

    await forgetTrip(id, user);

    expect(await databaseNames()).not.toContain(`rota-trip-${id}-${user}`);
    expect(await databaseNames()).toContain(`rota-trip-${other}-${user}`);
    expect(hasOfflineCopy(id, user)).toBe(false);
    expect(pendingCount(id, user)).toBe(0);
    expect(pendingCount(other, user)).toBe(1);
    expect(cachedTrips(user).map((t) => t.id)).toEqual([other]);
  });
});

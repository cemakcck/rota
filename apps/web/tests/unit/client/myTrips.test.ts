import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { newTripId } from "@rota/trip";
import { cacheTrips, cachedTrips, forgetTrip, hasOfflineCopy, markOfflineCopy, pendingChanges, setPendingChanges, type CachedTrip } from "@/client/myTrips";

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

afterEach(() => localStorage.clear());

describe("my trips cache", () => {
  it("round-trips the trip list", () => {
    const list = [trip(newTripId(), "Istanbul"), trip(newTripId(), "Lisbon")];
    cacheTrips(list);
    expect(cachedTrips()).toEqual(list);
  });

  it("cachedTrips survives corrupted storage", () => {
    localStorage.setItem("rota.myTrips", "{not json");
    expect(cachedTrips()).toEqual([]);
    localStorage.setItem("rota.myTrips", JSON.stringify({ trips: "nope" }));
    expect(cachedTrips()).toEqual([]);
    localStorage.setItem("rota.myTrips", JSON.stringify([trip(newTripId(), "ok"), { id: 7 }, null]));
    expect(cachedTrips().map((t) => t.name)).toEqual(["ok"]);
    localStorage.setItem("rota.offlineTrips", "[[[");
    expect(hasOfflineCopy(newTripId())).toBe(false);
    const id = newTripId();
    localStorage.setItem(`rota.pending.${id}`, "lots");
    expect(pendingChanges(id)).toBe(0);
  });

  it("remembers which trips have an offline copy", () => {
    const id = newTripId();
    expect(hasOfflineCopy(id)).toBe(false);
    markOfflineCopy(id);
    markOfflineCopy(id);
    expect(hasOfflineCopy(id)).toBe(true);
  });

  it("forgetTrip deletes the trip's IndexedDB database", async () => {
    const id = newTripId();
    const other = newTripId();
    for (const tripId of [id, other]) {
      const doc = new Y.Doc();
      doc.getMap("meta").set("name", "Istanbul");
      const idb = new IndexeddbPersistence(`rota-trip-${tripId}`, doc);
      await idb.whenSynced;
      await idb.destroy();
    }
    cacheTrips([trip(id, "Istanbul"), trip(other, "Lisbon")]);
    markOfflineCopy(id);
    setPendingChanges(id, 3);
    expect(await databaseNames()).toContain(`rota-trip-${id}`);

    await forgetTrip(id);

    expect(await databaseNames()).not.toContain(`rota-trip-${id}`);
    expect(await databaseNames()).toContain(`rota-trip-${other}`);
    expect(hasOfflineCopy(id)).toBe(false);
    expect(pendingChanges(id)).toBe(0);
    expect(cachedTrips().map((t) => t.id)).toEqual([other]);
  });
});

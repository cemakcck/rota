import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CATEGORIES,
  DEFAULT_STAY_MINUTES,
  addPlace,
  initTrip,
  isTripId,
  newId,
  newTripId,
  readTrip,
  updatePlace,
  vote,
} from "../src";

function trip(days = 2): Y.Doc {
  const doc = new Y.Doc();
  initTrip(doc, { name: "Istanbul", startDate: "2026-11-30", days, locale: "en" }, "u1");
  return doc;
}

describe("trip document", () => {
  it("readTrip skips a malformed place instead of throwing", () => {
    // Only a place that cannot be put in any list (no valid order key) is
    // skipped; anything else is shown with defaults so no one's work vanishes.
    const doc = trip();
    const dayId = readTrip(doc).days[0].id;
    addPlace(doc, { name: "Galata Tower", lat: 41.0256, lng: 28.9741, category: "sight", dayId }, "u1");
    const places = doc.getMap<Y.Map<unknown>>("places");
    doc.transact(() => {
      const badOrder = new Y.Map<unknown>();
      badOrder.set("name", "Unplaceable");
      badOrder.set("category", "food");
      badOrder.set("order", 42);
      badOrder.set("dayId", dayId);
      badOrder.set("status", "planned");
      places.set("badorder", badOrder);
      const badCoords = new Y.Map<unknown>();
      badCoords.set("name", "Nowhere");
      badCoords.set("lat", Number.NaN);
      badCoords.set("lng", "east");
      badCoords.set("category", "food");
      badCoords.set("order", "a6");
      badCoords.set("dayId", dayId);
      badCoords.set("status", "planned");
      places.set("badcoords", badCoords);
      places.set("notamap", "garbage" as unknown as Y.Map<unknown>);
    });
    let view!: ReturnType<typeof readTrip>;
    expect(() => (view = readTrip(doc))).not.toThrow();
    expect(view.days[0].places.map((p) => p.name)).toEqual(["Galata Tower", "Nowhere"]);
    expect(view.days[0].places[1]).toMatchObject({ lat: null, lng: null });
    expect(view.placeCount).toBe(2);
  });

  it("a blank name never hides a place", () => {
    const doc = trip();
    const dayId = readTrip(doc).days[0].id;
    expect(() => addPlace(doc, { name: "   ", category: "food", dayId }, "u1")).toThrow();
    const id = addPlace(doc, { name: "  Karaköy Lokantası ", category: "food", dayId }, "u1");
    updatePlace(doc, id, { name: "", stayMinutes: 50 }, "u1");
    updatePlace(doc, id, { name: "  \t" }, "u1");
    let place = readTrip(doc).days[0].places[0];
    expect(place).toMatchObject({ id, name: "Karaköy Lokantası", stayMinutes: 50 });

    // Written by an older or broken client: still listed, with an empty name.
    doc.getMap<Y.Map<unknown>>("places").get(id)!.delete("name");
    const view = readTrip(doc);
    place = view.days[0].places[0];
    expect(place).toMatchObject({ id, name: "" });
    expect(view.placeCount).toBe(1);
  });

  it("unknown category reads as other", () => {
    const doc = trip();
    const id = addPlace(doc, { name: "Mystery", category: "food", dayId: null }, "u1");
    doc.getMap<Y.Map<unknown>>("places").get(id)!.set("category", "karaoke");
    const place = readTrip(doc).ideas.find((p) => p.id === id)!;
    expect(place.category).toBe("other");
    expect(place.lat).toBeNull();
    expect(place.lng).toBeNull();
  });

  it("day dates follow startDate across a month end", () => {
    const view = readTrip(trip(3));
    expect(view.days.map((d) => d.date)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(view.days.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(view.days.every((d) => d.startTime === "09:00" && d.travelMode === "walk")).toBe(true);
    expect(view.name).toBe("Istanbul");
    expect(view.startDate).toBe("2026-11-30");
    expect(view.destination).toBeNull();
    expect(view.isDemo).toBe(false);
    expect(view.locale).toBe("en");
  });

  it("stay minutes default from category", () => {
    expect(CATEGORIES).toEqual([
      "food", "drinks", "cafe", "museum", "sight", "nightlife",
      "shopping", "nature", "gym", "stay", "other",
    ]);
    expect(DEFAULT_STAY_MINUTES).toEqual({
      food: 75, drinks: 60, cafe: 45, museum: 120, sight: 45, nightlife: 120,
      shopping: 60, nature: 90, gym: 60, stay: 0, other: 60,
    });
    const doc = trip();
    for (const category of CATEGORIES) {
      addPlace(doc, { name: category, category, dayId: null }, "u1");
    }
    const custom = addPlace(doc, { name: "Long lunch", category: "food", stayMinutes: 150, dayId: null }, "u1");
    const ideas = readTrip(doc).ideas;
    for (const category of CATEGORIES) {
      expect(ideas.find((p) => p.name === category)!.stayMinutes).toBe(DEFAULT_STAY_MINUTES[category]);
    }
    expect(ideas.find((p) => p.id === custom)!.stayMinutes).toBe(150);
    expect(ideas.map((p) => p.name).slice(0, CATEGORIES.length)).toEqual([...CATEGORIES]);
  });

  it("score is the sum of votes and a user votes once", () => {
    const doc = trip();
    const id = addPlace(doc, { name: "Rooftop bar", category: "drinks", dayId: null, status: "suggested" }, "u1");
    vote(doc, id, "u1", 1);
    vote(doc, id, "u1", 1);
    vote(doc, id, "u2", 1);
    vote(doc, id, "u3", -1);
    let place = readTrip(doc).suggestions.find((p) => p.id === id)!;
    expect(place.votes).toEqual({ u1: 1, u2: 1, u3: -1 });
    expect(place.score).toBe(1);
    vote(doc, id, "u3", 1); // changeable
    vote(doc, id, "u2", 0); // withdrawn
    place = readTrip(doc).suggestions.find((p) => p.id === id)!;
    expect(place.votes).toEqual({ u1: 1, u3: 1 });
    expect(place.score).toBe(2);
  });

  it("ids are base62: 22 chars for trips, 12 otherwise", () => {
    const tripId = newTripId();
    expect(tripId).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(isTripId(tripId)).toBe(true);
    expect(isTripId("short")).toBe(false);
    expect(isTripId(`${tripId.slice(0, 21)}-`)).toBe(false);
    expect(newId()).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(new Set(Array.from({ length: 1000 }, newTripId)).size).toBe(1000);
  });

  it("top-level shares are exactly meta, places, days, checklist, members", () => {
    const doc = trip();
    expect([...doc.share.keys()].sort()).toEqual(["checklist", "days", "members", "meta", "places"]);
  });
});

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addPlace, initTrip, MEMBER_COLOURS, readTrip, setPlaceStatus, type Destination } from "@rota/trip";
import { CITY_PAD, DAY_COLOURS, IDEAS_COLOUR, ISTANBUL, mapFeatures } from "@/components/map/mapFeatures";

function trip({ days = 2, destination = null }: { days?: number; destination?: Destination | null } = {}) {
  const doc = new Y.Doc();
  initTrip(
    doc,
    {
      name: "Istanbul",
      startDate: "2026-11-27",
      days,
      destination,
      locale: "en",
    },
    "seed",
  );
  return { doc, dayIds: readTrip(doc).days.map((d) => d.id) };
}

const none = new Set<string>();
const all = { kind: "all" } as const;
const ideas = { kind: "ideas" } as const;
const day = (dayId: string) => ({ kind: "day", dayId }) as const;

describe("mapFeatures", () => {
  it("pins are numbered per day in order with the day colour", () => {
    const { doc, dayIds } = trip();
    const a = addPlace(
      doc,
      {
        name: "Galata Tower",
        category: "sight",
        dayId: dayIds[0],
        lat: 41.0256,
        lng: 28.9742,
      },
      "u1",
    );
    const b = addPlace(
      doc,
      {
        name: "Karaköy Lokantası",
        category: "food",
        dayId: dayIds[0],
        lat: 41.0228,
        lng: 28.9779,
      },
      "u1",
    );
    const c = addPlace(
      doc,
      {
        name: "Chora Church",
        category: "museum",
        dayId: dayIds[1],
        lat: 41.0312,
        lng: 28.9393,
      },
      "u1",
    );
    const idea = addPlace(
      doc,
      {
        name: "Pierre Loti",
        category: "cafe",
        dayId: null,
        lat: 41.0536,
        lng: 28.9338,
      },
      "u1",
    );

    const { pins } = mapFeatures(readTrip(doc), {
      shown: all,
      hiddenIds: none,
    });
    expect(pins.map((p) => [p.id, p.number, p.colour, p.category, p.dayId])).toEqual([
      [a, 1, DAY_COLOURS[0], "sight", dayIds[0]],
      [b, 2, DAY_COLOURS[0], "food", dayIds[0]],
      [c, 1, DAY_COLOURS[1], "museum", dayIds[1]],
      [idea, null, IDEAS_COLOUR, "cafe", null],
    ]);
    expect(pins[0]).toMatchObject({
      name: "Galata Tower",
      lat: 41.0256,
      lng: 28.9742,
    });

    // Eight day colours, none of them a member colour; the ninth day reuses the first.
    expect(new Set(DAY_COLOURS).size).toBe(8);
    for (const colour of DAY_COLOURS) expect(MEMBER_COLOURS as readonly string[]).not.toContain(colour);
    const long = trip({ days: 9 });
    addPlace(
      long.doc,
      {
        name: "Ninth",
        category: "other",
        dayId: long.dayIds[8],
        lat: 41,
        lng: 29,
      },
      "u1",
    );
    expect(mapFeatures(readTrip(long.doc), { shown: all, hiddenIds: none }).pins[0].colour).toBe(DAY_COLOURS[0]);

  });

  it("mapFeatures for a day returns that day's numbered pins and route", () => {
    const { doc, dayIds } = trip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], lat: 41.0, lng: 28.9 }, "u1");
    const b = addPlace(doc, { name: "B", category: "food", dayId: dayIds[0], lat: 41.1, lng: 29.0 }, "u1");
    addPlace(doc, { name: "Other day", category: "sight", dayId: dayIds[1], lat: 41.3, lng: 29.2 }, "u1");
    addPlace(doc, { name: "Idea", category: "cafe", dayId: null, lat: 41.4, lng: 29.3 }, "u1");
    const features = mapFeatures(readTrip(doc), { shown: day(dayIds[0]), hiddenIds: none });
    // Only that day: no other day's pins, no Ideas.
    expect(features.pins.map((p) => [p.id, p.number, p.colour])).toEqual([
      [a, 1, DAY_COLOURS[0]],
      [b, 2, DAY_COLOURS[0]],
    ]);
    expect(features.routes).toEqual([
      { line: { type: "LineString", coordinates: [[28.9, 41.0], [29.0, 41.1]] }, colour: DAY_COLOURS[0], approximate: true },
    ]);
    expect(features.bounds).toEqual([28.9, 41.0, 29.0, 41.1]);
  });

  it("mapFeatures for ideas view returns only idea pins", () => {
    const { doc, dayIds } = trip();
    addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], lat: 41.0, lng: 28.9 }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0], lat: 41.1, lng: 29.0 }, "u1");
    const idea = addPlace(doc, { name: "Idea", category: "cafe", dayId: null, lat: 41.4, lng: 29.3 }, "u1");
    addPlace(doc, { name: "Suggested", category: "food", dayId: null, lat: 41, lng: 29, status: "suggested" }, "u1");
    const features = mapFeatures(readTrip(doc), { shown: ideas, hiddenIds: none });
    expect(features.pins.map((p) => [p.id, p.number, p.colour, p.dayId])).toEqual([[idea, null, IDEAS_COLOUR, null]]);
    expect(features.routes).toEqual([]);
    expect(features.bounds).toEqual([29.3, 41.4, 29.3, 41.4]);
  });

  it("the whole trip shows every day's pins and routes, and Ideas", () => {
    const { doc, dayIds } = trip();
    addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], lat: 41.0, lng: 28.9 }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0], lat: 41.1, lng: 29.0 }, "u1");
    addPlace(doc, { name: "C", category: "sight", dayId: dayIds[1], lat: 41.2, lng: 29.1 }, "u1");
    addPlace(doc, { name: "D", category: "sight", dayId: dayIds[1], lat: 41.3, lng: 29.2 }, "u1");
    addPlace(doc, { name: "Idea", category: "cafe", dayId: null, lat: 41.4, lng: 29.3 }, "u1");
    const features = mapFeatures(readTrip(doc), { shown: all, hiddenIds: none });
    expect(features.pins.map((p) => p.name)).toEqual(["A", "B", "C", "D", "Idea"]);
    expect(features.routes.map((r) => r.colour)).toEqual([DAY_COLOURS[0], DAY_COLOURS[1]]);
    expect(features.bounds).toEqual([28.9, 41.0, 29.3, 41.4]);
  });

  it("an empty day fits the trip's pins, then the destination", () => {
    const { doc, dayIds } = trip();
    addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], lat: 41.0, lng: 28.9 }, "u1");
    addPlace(doc, { name: "Idea", category: "cafe", dayId: null, lat: 41.4, lng: 29.3 }, "u1");
    const features = mapFeatures(readTrip(doc), { shown: day(dayIds[1]), hiddenIds: none });
    expect(features.pins).toEqual([]);
    expect(features.bounds).toEqual([28.9, 41.0, 29.3, 41.4]);
  });

  it("places without coordinates and filtered places are not pinned", () => {
    const { doc, dayIds } = trip();
    addPlace(doc, { name: "By hand", category: "food", dayId: dayIds[0] }, "u1");
    const pinned = addPlace(
      doc,
      {
        name: "Galata Tower",
        category: "sight",
        dayId: dayIds[0],
        lat: 41.0256,
        lng: 28.9742,
      },
      "u1",
    );
    const filtered = addPlace(
      doc,
      {
        name: "Filtered",
        category: "food",
        dayId: dayIds[0],
        lat: 41.02,
        lng: 28.97,
      },
      "u1",
    );
    const last = addPlace(
      doc,
      {
        name: "Last",
        category: "sight",
        dayId: dayIds[0],
        lat: 41.01,
        lng: 28.96,
      },
      "u1",
    );
    addPlace(
      doc,
      {
        name: "Suggested",
        category: "food",
        dayId: null,
        lat: 41,
        lng: 29,
        status: "suggested",
      },
      "u1",
    );
    const dismissed = addPlace(doc, { name: "Dismissed", category: "food", dayId: null, lat: 41, lng: 29 }, "u1");
    setPlaceStatus(doc, dismissed, "dismissed", "u1");

    const { pins } = mapFeatures(readTrip(doc), {
      shown: all,
      hiddenIds: new Set([filtered]),
    });
    // The numbers stay those of the list, where unpinned and filtered places keep their places.
    expect(pins.map((p) => [p.id, p.number])).toEqual([
      [pinned, 2],
      [last, 4],
    ]);
  });

  it("route uses road geometry when given, else straight segments", () => {
    const { doc, dayIds } = trip();
    addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], lat: 41.0, lng: 28.9 }, "u1");
    addPlace(doc, { name: "No coordinates", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0], lat: 41.1, lng: 29.0 }, "u1");
    addPlace(doc, { name: "C", category: "sight", dayId: dayIds[0], lat: 41.2, lng: 29.1 }, "u1");
    addPlace(
      doc,
      {
        name: "Alone",
        category: "sight",
        dayId: dayIds[1],
        lat: 41.3,
        lng: 29.2,
      },
      "u1",
    );
    const view = readTrip(doc);

    expect(mapFeatures(view, { shown: day(dayIds[0]), hiddenIds: none }).routes[0]).toEqual({
      line: {
        type: "LineString",
        coordinates: [
          [28.9, 41.0],
          [29.0, 41.1],
          [29.1, 41.2],
        ],
      },
      colour: DAY_COLOURS[0],
      approximate: true,
    });

    const road: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [
        [28.9, 41.0],
        [28.95, 41.04],
        [29.0, 41.1],
        [29.1, 41.2],
      ],
    };
    expect(
      mapFeatures(view, {
        shown: day(dayIds[0]),
        hiddenIds: none,
        routeGeometry: { [dayIds[0]]: road },
      }).routes[0],
    ).toEqual({
      line: road,
      colour: DAY_COLOURS[0],
      approximate: false,
    });

    // One stop is no route; Ideas have none.
    expect(mapFeatures(view, { shown: day(dayIds[1]), hiddenIds: none }).routes).toEqual([]);
    expect(mapFeatures(view, { shown: ideas, hiddenIds: none }).routes).toEqual([]);
  });

  it("bounds fall back to destination then Istanbul", () => {
    const { doc, dayIds } = trip({
      destination: { name: "Rome", lat: 41.9, lng: 12.5 },
    });
    const a = addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], lat: 41.0, lng: 28.9 }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[1], lat: 41.2, lng: 29.1 }, "u1");
    addPlace(doc, { name: "C", category: "sight", dayId: dayIds[1], lat: 41.1, lng: 29.3 }, "u1");
    const view = readTrip(doc);

    // Over every visible pin, or the selected day's when it has any.
    expect(mapFeatures(view, { shown: all, hiddenIds: none }).bounds).toEqual([28.9, 41.0, 29.3, 41.2]);
    expect(mapFeatures(view, { shown: day(dayIds[1]), hiddenIds: none }).bounds).toEqual([29.1, 41.1, 29.3, 41.2]);
    expect(mapFeatures(view, { shown: day(dayIds[0]), hiddenIds: new Set([a]) }).bounds).toEqual([29.1, 41.1, 29.3, 41.2]);

    // No pins: the destination, then Istanbul, as a city-sized box.
    const empty = trip({ destination: { name: "Rome", lat: 41.9, lng: 12.5 } });
    expect(mapFeatures(readTrip(empty.doc), { shown: all, hiddenIds: none }).bounds).toEqual([
      12.5 - CITY_PAD,
      41.9 - CITY_PAD,
      12.5 + CITY_PAD,
      41.9 + CITY_PAD,
    ]);
    expect(
      mapFeatures(readTrip(trip().doc), {
        shown: all,
        hiddenIds: none,
      }).bounds,
    ).toEqual([ISTANBUL.lng - CITY_PAD, ISTANBUL.lat - CITY_PAD, ISTANBUL.lng + CITY_PAD, ISTANBUL.lat + CITY_PAD]);
  });
});

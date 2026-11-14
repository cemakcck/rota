import type { Category, PlaceView, TripView } from "@rota/trip";

/**
 * The day palette: one colour per day (the ninth day reuses the first). Deliberately not the member
 * colours, which mean "a person" (avatars, outlines, cursors). Each carries white pin numbers at AA.
 */
export const DAY_COLOURS = [
  "#1e3a8a", // navy
  "#9f1239", // crimson
  "#166534", // forest
  "#86198f", // plum
  "#9a3412", // rust
  "#155e75", // petrol
  "#4338ca", // indigo
  "#3f3f46", // graphite
] as const;

/** Ideas pins: grey and unnumbered. */
export const IDEAS_COLOUR = "#78716c";

/** Where the map opens when a trip has no pins and no destination. */
export const ISTANBUL = { lat: 41.0082, lng: 28.9784 };

/** Half the side, in degrees, of the box shown around a destination (about a city). */
export const CITY_PAD = 0.08;

export type Pin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** The day it is planned for; null in Ideas. */
  dayId: string | null;
  /** Its stop number in the day (as in the list); null in Ideas. */
  number: number | null;
  colour: string;
  category: Category;
  /** False while another day is selected: still shown, but quieter. */
  active: boolean;
};

export type Route = {
  line: GeoJSON.LineString;
  colour: string;
  approximate: boolean;
};

/** [west, south, east, north]. */
export type Bounds = [number, number, number, number];

export type MapFeatures = { pins: Pin[]; route: Route | null; bounds: Bounds };

export const dayColour = (index: number) => DAY_COLOURS[index % DAY_COLOURS.length];

const pinned = (p: PlaceView): p is PlaceView & { lat: number; lng: number } => p.lat !== null && p.lng !== null;

function boundsOf(points: { lat: number; lng: number }[]): Bounds {
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

const around = ({ lat, lng }: { lat: number; lng: number }): Bounds => [lng - CITY_PAD, lat - CITY_PAD, lng + CITY_PAD, lat + CITY_PAD];

/**
 * What the map shows (spec §6): pins for the planned places that have coordinates and pass the
 * filters, numbered per day in the day's colour, Ideas grey; the selected day's route, along roads when
 * `routeGeometry` has it, else straight between its consecutive pinned stops; and the area to fit (the
 * selected day's pins, else every pin, else the destination, else Istanbul).
 */
export function mapFeatures(
  view: TripView,
  {
    selectedDayId,
    hiddenIds,
    routeGeometry,
  }: {
    selectedDayId: string | null;
    hiddenIds: Set<string>;
    routeGeometry?: Record<string, GeoJSON.LineString>;
  },
): MapFeatures {
  const shown = (p: PlaceView): p is PlaceView & { lat: number; lng: number } => pinned(p) && !hiddenIds.has(p.id);
  const pins: Pin[] = [];
  for (const day of view.days) {
    const colour = dayColour(day.index);
    day.places.forEach((p, i) => {
      if (shown(p))
        pins.push(
          pinOf(p, {
            dayId: day.id,
            number: i + 1,
            colour,
            active: selectedDayId === null || selectedDayId === day.id,
          }),
        );
    });
  }
  for (const p of view.ideas)
    if (shown(p))
      pins.push(
        pinOf(p, {
          dayId: null,
          number: null,
          colour: IDEAS_COLOUR,
          active: selectedDayId === null,
        }),
      );

  const day = view.days.find((d) => d.id === selectedDayId);
  const stops = day ? pins.filter((p) => p.dayId === day.id) : [];
  const road = day && routeGeometry?.[day.id];
  const route: Route | null = !day
    ? null
    : road
      ? { line: road, colour: dayColour(day.index), approximate: false }
      : stops.length >= 2
        ? {
            line: {
              type: "LineString",
              coordinates: stops.map((p) => [p.lng, p.lat]),
            },
            colour: dayColour(day.index),
            approximate: true,
          }
        : null;

  const bounds = stops.length > 0 ? boundsOf(stops) : pins.length > 0 ? boundsOf(pins) : around(view.destination ?? ISTANBUL);
  return { pins, route, bounds };
}

function pinOf(p: PlaceView & { lat: number; lng: number }, at: Pick<Pin, "dayId" | "number" | "colour" | "active">): Pin {
  return {
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    category: p.category,
    ...at,
  };
}

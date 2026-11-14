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

/** What the map follows: one day, Ideas, or the whole trip (the list column's view). */
export type MapShown = { kind: "day"; dayId: string } | { kind: "ideas" } | { kind: "all" };

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
};

export type Route = {
  line: GeoJSON.LineString;
  colour: string;
  approximate: boolean;
};

/** [west, south, east, north]. */
export type Bounds = [number, number, number, number];

export type MapFeatures = { pins: Pin[]; routes: Route[]; bounds: Bounds };

export const dayColour = (index: number) => DAY_COLOURS[index % DAY_COLOURS.length];

const pinned = (p: PlaceView): p is PlaceView & { lat: number; lng: number } => p.lat !== null && p.lng !== null;

function boundsOf(points: { lat: number; lng: number }[]): Bounds {
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

const around = ({ lat, lng }: { lat: number; lng: number }): Bounds => [lng - CITY_PAD, lat - CITY_PAD, lng + CITY_PAD, lat + CITY_PAD];

/**
 * What the map shows (spec §2): it follows the view. A day: its pins (that have coordinates and pass
 * the filters), numbered as in the list, in the day's colour, and its route, along roads when
 * `routeGeometry` has it, else straight between its consecutive pinned stops. Ideas: the idea pins
 * (grey, unnumbered). The whole trip: every day's pins and routes, and Ideas. The area to fit: the
 * shown pins, else every pin of the trip, else the destination, else Istanbul.
 */
export function mapFeatures(
  view: TripView,
  {
    shown,
    hiddenIds,
    routeGeometry,
  }: {
    shown: MapShown;
    hiddenIds: Set<string>;
    routeGeometry?: Record<string, GeoJSON.LineString>;
  },
): MapFeatures {
  const visible = (p: PlaceView): p is PlaceView & { lat: number; lng: number } => pinned(p) && !hiddenIds.has(p.id);
  const everyPin: Pin[] = [];
  const routes: Route[] = [];
  for (const day of view.days) {
    const colour = dayColour(day.index);
    const stops: Pin[] = [];
    day.places.forEach((p, i) => {
      if (visible(p)) stops.push(pinOf(p, { dayId: day.id, number: i + 1, colour }));
    });
    everyPin.push(...stops);
    if (shown.kind === "all" || (shown.kind === "day" && shown.dayId === day.id)) {
      const road = routeGeometry?.[day.id];
      if (road) routes.push({ line: road, colour, approximate: false });
      else if (stops.length >= 2) routes.push({ line: { type: "LineString", coordinates: stops.map((p) => [p.lng, p.lat]) }, colour, approximate: true });
    }
  }
  for (const p of view.ideas) if (visible(p)) everyPin.push(pinOf(p, { dayId: null, number: null, colour: IDEAS_COLOUR }));

  const pins = everyPin.filter((p) => shown.kind === "all" || (shown.kind === "ideas" ? p.dayId === null : p.dayId === shown.dayId));
  const bounds = pins.length > 0 ? boundsOf(pins) : everyPin.length > 0 ? boundsOf(everyPin) : around(view.destination ?? ISTANBUL);
  return { pins, routes, bounds };
}

function pinOf(p: PlaceView & { lat: number; lng: number }, at: Pick<Pin, "dayId" | "number" | "colour">): Pin {
  return {
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    category: p.category,
    ...at,
  };
}

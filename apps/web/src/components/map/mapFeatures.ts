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

/** Pin labels are cut to about this many characters (spec §2). */
export const PIN_LABEL_MAX = 18;
/** Below this zoom the map is too far out for labels: only the selected (or hovered) pin's shows. */
export const LABEL_MIN_ZOOM = 13;

/** A pin's label: its name, cut to PIN_LABEL_MAX characters with an ellipsis. */
export function pinLabel(name: string): string {
  const chars = [...name.trim()];
  return chars.length <= PIN_LABEL_MAX ? chars.join("") : `${chars.slice(0, PIN_LABEL_MAX - 1).join("").trimEnd()}…`;
}

/** A pin where it is on screen (container pixels of its tip), with its label. */
export type PlacedPin = { id: string; x: number; y: number; label: string; idea: boolean };

type Box = { left: number; top: number; right: number; bottom: number };
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Pin geometry (see PinMarker): a day pin's head is 34 px (42 selected), an idea's 24 px (32 selected),
// its tip 21% of that below it.
// The label sits right of the head, centred on it: 20 px high, about 7 px a character at 12 px.
const LABEL_HEIGHT = 20;
const LABEL_GAP = 4;
const labelWidth = (label: string) => [...label].length * 7 + 12;
function headBox({ x, y, idea }: PlacedPin, selected: boolean): Box {
  const size = idea ? (selected ? 32 : 24) : selected ? 42 : 34;
  const bottom = y - Math.round(size * 0.21);
  return { left: x - size / 2, top: bottom - size, right: x + size / 2, bottom };
}
function labelBox(pin: PlacedPin, selected: boolean): Box {
  const head = headBox(pin, selected);
  const middle = (head.top + head.bottom) / 2;
  const left = head.right + LABEL_GAP;
  return { left, top: middle - LABEL_HEIGHT / 2, right: left + labelWidth(pin.label), bottom: middle + LABEL_HEIGHT / 2 };
}

/**
 * Which pins show their label: none below LABEL_MIN_ZOOM; otherwise each, in order (the stops' order),
 * unless its label would overlap a label already shown or cover another pin. `keep` (the selected pin)
 * always shows its label, and is placed first so the others give way to it.
 */
export function labelledPins(pins: readonly PlacedPin[], { zoom, keep }: { zoom: number; keep: string | null }): Set<string> {
  const shown = new Set<string>();
  const kept = pins.find((p) => p.id === keep);
  if (kept) shown.add(kept.id);
  if (zoom < LABEL_MIN_ZOOM) return shown;
  const heads = pins.map((p) => ({ id: p.id, box: headBox(p, p.id === keep) }));
  const taken: Box[] = kept ? [labelBox(kept, true)] : [];
  for (const pin of pins) {
    if (pin.id === keep) continue;
    const box = labelBox(pin, false);
    if (taken.some((t) => overlaps(t, box)) || heads.some((h) => h.id !== pin.id && overlaps(h.box, box))) continue;
    shown.add(pin.id);
    taken.push(box);
  }
  return shown;
}

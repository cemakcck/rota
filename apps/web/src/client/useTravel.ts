import { useMemo } from "react";
import { estimateLeg, type DayView, type Leg, type TravelMode, type TripView } from "@rota/trip";
import { apiFetch } from "./authClient";
import { createRemote, getJson, useRemote } from "./remote";

/**
 * A day's travel: legs between consecutive stops (null where a stop has no coordinates). `loading` is
 * true while a route for the day is still being asked for (its legs are straight-line guesses until then).
 */
export type Travel = { legs: (Leg | null)[]; geometry: GeoJSON.LineString | null; totalSeconds: number; anyApproximate: boolean; loading: boolean };
type Routed = { legs: { seconds: number; meters: number }[]; geometry: GeoJSON.LineString };

/** The route service takes at most 25 points per request. */
const MAX_POINTS = 25;

const routes = createRemote<Routed>(async ([key], signal) => {
  const [mode, coords] = key.split("|");
  return new Map([[key, await getJson<Routed>(`/api/route?mode=${mode}&coords=${coords}`, apiFetch, signal)]]);
});

type Point = { lat: number; lng: number };
const routeKey = (mode: TravelMode, points: Point[]) => `${mode}|${points.map((p) => `${p.lng},${p.lat}`).join(";")}`;

/**
 * The route requests for a day: each run of consecutive stops with coordinates, cut into pieces of at
 * most 25 points that share their end points. `first` is the index of the piece's first stop.
 */
function pieces(day: DayView): { run: number; first: number; key: string }[] {
  const out: { run: number; first: number; key: string }[] = [];
  let run: number[] = [];
  let runs = 0;
  const flush = () => {
    for (let i = 0; i + 1 < run.length; i += MAX_POINTS - 1) {
      const stops = run.slice(i, i + MAX_POINTS).map((at) => day.places[at] as Point);
      out.push({ run: runs, first: run[i], key: routeKey(day.travelMode, stops) });
    }
    if (run.length > 1) runs++;
    run = [];
  };
  day.places.forEach((p, i) => {
    if (p.lat === null || p.lng === null) flush();
    else run.push(i);
  });
  flush();
  return out;
}

function travelOf(day: DayView, get: (key: string) => Routed | undefined, pending: (key: string) => boolean): Travel {
  const legs: (Leg | null)[] = day.places.slice(1).map(() => null);
  const parts = pieces(day);
  const lines: GeoJSON.Position[][] = [];
  for (const { first, key } of parts) {
    const routed = get(key);
    const count = key.split(";").length - 1;
    for (let i = 0; i < count; i++) {
      const [a, b] = [day.places[first + i], day.places[first + i + 1]] as Point[];
      legs[first + i] = routed ? { ...routed.legs[i], approximate: false } : estimateLeg(a, b, day.travelMode);
    }
    if (routed) lines.push(routed.geometry.coordinates);
  }
  // Road geometry when the day's stops form one run and all of it is routed (the pieces join end to end).
  const geometry: GeoJSON.LineString | null =
    lines.length > 0 && lines.length === parts.length && parts.every((p) => p.run === 0)
      ? { type: "LineString", coordinates: lines.flatMap((l, i) => (i === 0 ? l : l.slice(1))) }
      : null;
  const known = legs.filter((l): l is Leg => l !== null);
  return {
    legs,
    geometry,
    totalSeconds: known.reduce((sum, l) => sum + l.seconds, 0),
    anyApproximate: known.some((l) => l.approximate),
    loading: parts.some((p) => !get(p.key) && pending(p.key)),
  };
}

/**
 * Travel for every day of the trip, by day id: routed along roads or paths through our proxy, else
 * (offline, the service down) straight-line estimates marked approximate. Routes are asked for once
 * per distinct list of points and kept for the page's life.
 */
export function useTravels(view: TripView): Record<string, Travel> {
  const keys = useMemo(() => view.days.flatMap((d) => pieces(d).map((p) => p.key)), [view.days]);
  const { get, pending, version } = useRemote(routes, keys);
  return useMemo(
    () => Object.fromEntries(view.days.map((d) => [d.id, travelOf(d, get, pending)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` changes as routes arrive in `get`'s cache
    [view.days, get, pending, version],
  );
}

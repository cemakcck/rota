import type { TravelMode } from "./schema";

export type Leg = { seconds: number; meters: number; approximate: boolean };
type Point = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
const DETOUR = 1.3;
const SPEED_KMH: Record<TravelMode, number> = { walk: 4.5, drive: 30 };

export function haversineMeters(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line estimate padded for detours; always flagged approximate. */
export function estimateLeg(a: Point, b: Point, mode: TravelMode): Leg {
  const meters = haversineMeters(a, b) * DETOUR;
  const seconds = (meters / ((SPEED_KMH[mode] * 1000) / 3600));
  return { seconds: Math.round(seconds), meters: Math.round(meters), approximate: true };
}

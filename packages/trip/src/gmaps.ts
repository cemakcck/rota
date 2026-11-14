import type { DayView, PlaceView, TravelMode } from "./schema";

const MAX_WAYPOINTS = 9;
const BASE = "https://www.google.com/maps";

type Located = PlaceView & { lat: number; lng: number };
const coords = (p: Located) => `${p.lat},${p.lng}`;

export function placeUrl(p: PlaceView): string {
  const query = p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : encodeURIComponent(p.name);
  return `${BASE}/search/?api=1&query=${query}`;
}

/** Directions links for a day; long days split into links sharing the boundary stop. */
export function dayUrls(day: DayView, mode: TravelMode): string[] {
  const stops = day.places.filter((p): p is Located => p.lat != null && p.lng != null);
  if (stops.length === 0) return [];
  if (stops.length === 1) return [placeUrl(stops[0])];
  const travelmode = mode === "drive" ? "driving" : "walking";
  const urls: string[] = [];
  // origin + destination + up to 9 waypoints = 11 stops per link.
  const span = MAX_WAYPOINTS + 1;
  for (let start = 0; start < stops.length - 1; start += span) {
    const chunk = stops.slice(start, start + span + 1);
    const via = chunk.slice(1, -1).map(coords).join("|");
    const params = [
      "api=1",
      `origin=${coords(chunk[0])}`,
      `destination=${coords(chunk[chunk.length - 1])}`,
      ...(via ? [`waypoints=${via}`] : []),
      `travelmode=${travelmode}`,
    ];
    urls.push(`${BASE}/dir/?${params.join("&")}`);
  }
  return urls;
}

import type { TravelMode } from "@rota/trip";
import { createCache } from "./cache";
import { throttled, UpstreamUnavailable } from "./upstream";

export type RouteResult = { legs: { seconds: number; meters: number }[]; geometry: GeoJSON.LineString };
type OsrmResponse = { code?: string; routes?: { geometry?: GeoJSON.LineString; legs?: { duration: number; distance: number }[] }[] };

const PROFILES: Record<TravelMode, string> = { walk: "routed-foot", drive: "routed-car" };
const osrm = throttled("osrm");
// Full road geometry can run to hundreds of KB for a long drive, so the cache is capped by size too.
const routes = createCache<RouteResult>(2000, 24 * 3600 * 1000, { maxBytes: 32 * 1024 * 1024, sizeOf: (r) => JSON.stringify(r).length });

/** Travel between consecutive points along roads or paths (FOSSGIS OSRM), as `[lng, lat]` pairs. */
export async function routeBetween(mode: TravelMode, coords: [number, number][]): Promise<RouteResult> {
  const path = coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = `https://routing.openstreetmap.de/${PROFILES[mode]}/route/v1/driving/${path}?overview=full&geometries=geojson`;
  const cached = routes.get(url);
  if (cached) return cached;
  const body = await osrm<OsrmResponse>(url);
  const best = body.routes?.[0];
  if (body.code !== "Ok" || !best?.geometry || best.legs?.length !== coords.length - 1) throw new UpstreamUnavailable(`osrm: unexpected answer ${body.code}`);
  const result: RouteResult = {
    legs: best.legs.map((l) => ({ seconds: Math.round(l.duration), meters: Math.round(l.distance) })),
    geometry: best.geometry,
  };
  routes.set(url, result);
  return result;
}

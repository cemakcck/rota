import type { Category } from "@rota/trip";
import { createCache } from "./cache";
import { throttled } from "./upstream";

export type SearchResult = { name: string; label: string; lat: number; lng: number; osmId: string; category: Category };

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
};
type PhotonResponse = { features?: PhotonFeature[] };

const DAY_MS = 24 * 3600 * 1000;
const photon = throttled("photon");
const searches = createCache<SearchResult[]>(1000, DAY_MS);
const names = createCache<string | null>(1000, DAY_MS);

const BY_VALUE: Record<string, Category> = {
  restaurant: "food",
  fast_food: "food",
  bar: "drinks",
  pub: "drinks",
  cafe: "cafe",
  museum: "museum",
  gallery: "museum",
  attraction: "sight",
  viewpoint: "sight",
  monument: "sight",
  place_of_worship: "sight",
  nightclub: "nightlife",
  park: "nature",
  beach: "nature",
  garden: "nature",
  fitness_centre: "gym",
  sports_centre: "gym",
  hotel: "stay",
  hostel: "stay",
  guest_house: "stay",
};

/** The suggested category for an OSM key/value pair (spec §5); the person can change it. */
export function categoryOf(key: unknown, value: unknown): Category {
  if (key === "shop") return "shopping";
  return (typeof value === "string" && BY_VALUE[value]) || "other";
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const OSM_TYPES: Record<string, string> = { N: "n", W: "w", R: "r" };
/** Coordinates rounded to about a kilometre: close enough for a bias, and shared by nearby searches. */
const coarse = (n: number) => Math.round(n * 100) / 100;

function toResult(f: PhotonFeature): SearchResult | null {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  const type = OSM_TYPES[String(p.osm_type)];
  if (!type || typeof p.osm_id !== "number" || typeof lat !== "number" || typeof lng !== "number") return null;
  const street = [text(p.street), text(p.housenumber)].filter(Boolean).join(" ");
  const name = text(p.name) ?? (street || null);
  if (!name) return null;
  const parts = [street, text(p.district), text(p.city), text(p.state), text(p.country)].filter((s): s is string => !!s && s !== name);
  // Neighbouring parts often repeat (a city that is also its state).
  const label = parts.filter((s, i) => parts.indexOf(s) === i).join(", ");
  return { name, label, lat, lng, osmId: `${type}${p.osm_id}`, category: categoryOf(p.osm_key, p.osm_value) };
}

/**
 * Places matching `q` near the bias point. Turkish sends no `lang`, so Photon answers with the local
 * names; English asks for English ones.
 */
export async function search(q: string, near: { lat: number; lng: number } | null, lang: "en" | "tr"): Promise<SearchResult[]> {
  const params = [`q=${encodeURIComponent(q)}`, "limit=8"];
  if (near) params.push(`lat=${coarse(near.lat)}`, `lon=${coarse(near.lng)}`);
  if (lang === "en") params.push("lang=en");
  const url = `https://photon.komoot.io/api/?${params.join("&")}`;
  const cached = searches.get(url);
  if (cached) return cached;
  const body = await photon<PhotonResponse>(url);
  const results = (body.features ?? []).map(toResult).filter((r): r is SearchResult => r !== null);
  searches.set(url, results);
  return results;
}

/** The name of the place at a point (for a place added on the map), or null. */
export async function reverseName(lat: number, lng: number): Promise<string | null> {
  const url = `https://photon.komoot.io/reverse?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&limit=1`;
  const cached = names.get(url);
  if (cached !== undefined) return cached;
  const body = await photon<PhotonResponse>(url);
  const p = body.features?.[0]?.properties ?? {};
  const name = text(p.name) ?? ([text(p.street), text(p.housenumber)].filter(Boolean).join(" ") || null);
  names.set(url, name);
  return name;
}

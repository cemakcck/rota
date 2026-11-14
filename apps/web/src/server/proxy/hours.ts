import { createCache } from "./cache";
import { throttled } from "./upstream";

type OverpassResponse = { elements?: { type: string; id: number; tags?: Record<string, string> }[] };

const TYPES: Record<string, string> = { n: "node", w: "way", r: "relation" };
const overpass = throttled("overpass");
const known = createCache<string | null>(5000, 7 * 24 * 3600 * 1000);

/**
 * OpenStreetMap's `opening_hours` tag for each id ("n123", "w45", "r6"); null when the place has none.
 * Ids not cached yet are asked for together in one Overpass query.
 */
export async function openingHours(ids: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const missing: string[] = [];
  for (const id of ids) {
    const hit = known.get(id);
    if (hit === undefined) missing.push(id);
    else out[id] = hit;
  }
  if (missing.length > 0) {
    const byType = new Map<string, string[]>();
    for (const id of missing) byType.set(TYPES[id[0]], [...(byType.get(TYPES[id[0]]) ?? []), id.slice(1)]);
    const query = `[out:json][timeout:10];(${[...byType].map(([type, nums]) => `${type}(id:${nums.join(",")});`).join("")});out tags;`;
    const body = await overpass<OverpassResponse>(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
    const found = new Map((body.elements ?? []).map((e) => [`${e.type[0]}${e.id}`, e.tags?.opening_hours ?? null]));
    for (const id of missing) {
      out[id] = found.get(id) ?? null;
      known.set(id, out[id]);
    }
  }
  return out;
}

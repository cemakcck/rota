import type { Category } from "@rota/trip";
import { apiFetch } from "./authClient";
import { getJson } from "./remote";

export type SearchResult = { name: string; label: string; lat: number; lng: number; osmId: string; category: Category };

/** Places matching `q` (Photon through our proxy), near `near` when given. Throws when offline or unavailable. */
export async function searchPlaces(q: string, lang: string, near: { lat: number; lng: number } | null, signal?: AbortSignal): Promise<SearchResult[]> {
  const bias = near ? `&lat=${near.lat.toFixed(2)}&lng=${near.lng.toFixed(2)}` : "";
  const res = await apiFetch(`/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}${bias}`, { signal });
  if (!res.ok) throw new SearchUnavailable(res.status);
  return uniqueResults(((await res.json()) as { results: SearchResult[] }).results);
}

/**
 * Each place once: Photon can return the same OpenStreetMap element twice. `osmId` carries the element's
 * type and number ("n555", "w555"), so a node and a way with the same number both stay. The first wins.
 */
export function uniqueResults(results: readonly SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => !seen.has(r.osmId) && (seen.add(r.osmId), true));
}

/** The search service answered with an error (as opposed to the network failing). */
export class SearchUnavailable extends Error {
  constructor(readonly status: number) {
    super(`search: ${status}`);
  }
}

/** The name of the place at a point, for a place added on the map; null when unknown. */
export async function reverseGeocode({ lat, lng }: { lat: number; lng: number }): Promise<string | null> {
  return (await getJson<{ name: string | null }>(`/api/geocode/reverse?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`, apiFetch)).name;
}

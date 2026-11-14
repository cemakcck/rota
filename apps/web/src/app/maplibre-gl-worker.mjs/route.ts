import { readFile } from "node:fs/promises";
import { findUp } from "@/server/files";

/**
 * MapLibre's web worker, served from this origin (a module worker must be same-origin, and bundling
 * moves MapLibre away from the file next to it that it would look for). Versioned by the `v` query the
 * map adds, so it can be cached for good.
 */
export async function GET() {
  return new Response(await readFile(await findUp("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url)), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" },
  });
}

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * MapLibre's web worker, served from this origin (a module worker must be same-origin, and bundling
 * moves MapLibre away from the file next to it that it would look for). Versioned by the `v` query the
 * map adds, so it can be cached for good.
 */
export async function GET() {
  const file = createRequire(path.join(process.cwd(), "package.json")).resolve("maplibre-gl/dist/maplibre-gl-worker.mjs");
  return new Response(await readFile(file), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" },
  });
}

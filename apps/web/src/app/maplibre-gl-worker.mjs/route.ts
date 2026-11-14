import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER = "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs";

/**
 * The worker file, found the way Node finds packages: in `node_modules` of this module's directory or
 * the nearest ancestor that has it. Starting from this module (in apps/web, as source or as a built
 * chunk) rather than the working directory keeps it working however the server was started.
 */
async function workerFile(): Promise<string> {
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); ; dir = path.dirname(dir)) {
    const file = path.join(dir, WORKER);
    if (await access(file).then(() => true, () => false)) return file;
    if (path.dirname(dir) === dir) throw new Error(`${WORKER} not found`);
  }
}

/**
 * MapLibre's web worker, served from this origin (a module worker must be same-origin, and bundling
 * moves MapLibre away from the file next to it that it would look for). Versioned by the `v` query the
 * map adds, so it can be cached for good.
 */
export async function GET() {
  return new Response(await readFile(await workerFile()), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" },
  });
}

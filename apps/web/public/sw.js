// Rota's service worker (spec §10), hand-written. The trips themselves live in IndexedDB; this keeps
// the pages, the app's static files and the map tiles seen online, so the app opens offline.
//
// - Pages: network first, the last copy offline. Kept: the precached shell and My trips, and every trip
//   page visited (/{locale}/t/{id}). A page never seen falls back to /offline.html.
// - /_next/static/*, MapLibre's worker and the icons: cache first (their URLs change when they do).
// - OpenFreeMap style, tiles, fonts and sprites: cache first, at most MAX_TILES entries, oldest out.
// - /api/* and /sync: never touched.

const VERSION = "v1";
const PAGES = `rota-pages-${VERSION}`;
const STATIC = `rota-static-${VERSION}`;
// Tiles do not change with the app, so a new version keeps them.
const TILES = "rota-tiles";
const CURRENT = [PAGES, STATIC, TILES];
const MAX_TILES = 2000;
const TILE_HOST = "tiles.openfreemap.org";
const OFFLINE = "/offline.html";
const PRECACHE = ["/en", "/tr", "/en/trips", "/tr/trips", OFFLINE];
const TRIP_PAGE = /^\/(en|tr)\/t\/[^/]+$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES);
      // One by one: a page that cannot be fetched now (a server hiccup) must not fail the install.
      await Promise.all(PRECACHE.map((path) => keep(cache, path)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("rota-") && !CURRENT.includes(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname === "/sync" || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
    if (request.mode === "navigate") return event.respondWith(page(request, url));
    if (url.pathname.startsWith("/_next/static/") || url.pathname === "/maplibre-gl-worker.mjs" || url.pathname.startsWith("/icons/"))
      return event.respondWith(cacheFirst(STATIC, request, event));
    return;
  }
  if (url.hostname === TILE_HOST) event.respondWith(cacheFirst(TILES, request, event));
});

/** Fetches `path` into `cache` if the server answers it; failures are ignored. */
async function keep(cache, path) {
  try {
    const res = await fetch(path, { cache: "reload" });
    if (res.ok) await cache.put(new URL(path, self.location.origin).href, res);
  } catch {
    // Offline or refused: the page is cached on the next visit instead.
  }
}

/** A page: from the network (kept if it is one to keep), else its last copy, else the offline page. */
async function page(request, url) {
  // The query (a friend window's ?friend=1) does not change the page.
  const key = url.origin + url.pathname;
  try {
    const res = await fetch(request);
    if (res.ok && (TRIP_PAGE.test(url.pathname) || PRECACHE.includes(url.pathname))) {
      const cache = await caches.open(PAGES);
      await cache.put(key, res.clone());
    }
    return res;
  } catch (error) {
    const cache = await caches.open(PAGES);
    const copy = (await cache.match(key)) ?? (await cache.match(url.origin + OFFLINE));
    if (copy) return copy;
    throw error;
  }
}

let trimming = Promise.resolve();

/** From cache `name` if there, else from the network and kept. Tiles beyond MAX_TILES are evicted, oldest first. */
async function cacheFirst(name, request, event) {
  const cache = await caches.open(name);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request.url, res.clone());
    if (name === TILES) {
      // One trim at a time, so concurrent tiles never evict more than they should.
      trimming = trimming.then(() => trim(cache)).catch(() => undefined);
      event.waitUntil(trimming);
    }
  }
  return res;
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(keys.length - MAX_TILES, 0))) await cache.delete(key);
}

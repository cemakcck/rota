import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSw } from "@/client/registerSw";

// src/sw/sw.js runs as served (its build id filled in, see app/sw.js/route.ts), against a fake service
// worker global: `self` collects the event handlers, and `caches` / `fetch` are stand-ins the tests control.

const SOURCE = readFileSync(`${import.meta.dirname}/../../src/sw/sw.js`, "utf8");
const ORIGIN = "https://rota.test";

type FakeRequest = { url: string; method: string; mode: string };
type Event = { request?: FakeRequest; respondWith: (r: Promise<Response>) => void; waitUntil: (p: Promise<unknown>) => void };

/** An ordered Cache: keys come back in insertion order, as the Cache API specifies. */
class FakeCache {
  entries = new Map<string, Response>();
  async match(key: string | FakeRequest) {
    return this.entries.get(typeof key === "string" ? key : key.url)?.clone();
  }
  async put(key: string | FakeRequest, res: Response) {
    const url = typeof key === "string" ? key : key.url;
    this.entries.delete(url);
    this.entries.set(url, res);
  }
  async delete(key: string | FakeRequest) {
    return this.entries.delete(typeof key === "string" ? key : key.url);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
}

function fakeCaches() {
  const store = new Map<string, FakeCache>();
  return {
    store,
    open: vi.fn(async (name: string) => {
      if (!store.has(name)) store.set(name, new FakeCache());
      return store.get(name)!;
    }),
    keys: vi.fn(async () => [...store.keys()]),
    delete: vi.fn(async (name: string) => store.delete(name)),
    match: vi.fn(async (key: string) => {
      for (const cache of store.values()) {
        const hit = await cache.match(key);
        if (hit) return hit;
      }
      return undefined;
    }),
  };
}

/** The worker of build `build`; pass `caches` to install it over an earlier build's. */
function loadSw({ build = "build-1", caches = fakeCaches() } = {}) {
  const handlers: Record<string, (e: Event) => void> = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, handler: (e: Event) => void) => (handlers[type] = handler),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  // `tag` marks what the server sends now; paths in `redirects` answer with a followed redirect.
  const network = { online: true, tag: "", redirects: new Set<string>() };
  const fetch = vi.fn(async (input: string | FakeRequest) => {
    if (!network.online) throw new TypeError("Failed to fetch");
    const url = typeof input === "string" ? new URL(input, ORIGIN).href : input.url;
    const res = new Response(`network ${url}${network.tag}`, { status: 200 });
    if (network.redirects.has(new URL(url).pathname)) Object.defineProperty(res, "redirected", { value: true });
    return res;
  });
  new Function("self", "caches", "fetch", SOURCE.replaceAll("__BUILD_ID__", build))(self, caches, fetch);

  /** Fires an event; resolves with what was passed to respondWith (undefined if nothing) after waitUntil settles. */
  async function fire(type: string, request?: FakeRequest): Promise<Response | undefined> {
    let responded: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    handlers[type]({ request, respondWith: (r) => (responded = r), waitUntil: (p) => waits.push(p) });
    const res = await responded;
    await Promise.all(waits);
    return res;
  }
  const get = (path: string, mode = "cors"): FakeRequest => ({ url: new URL(path, ORIGIN).href, method: "GET", mode });
  return { fire, get, caches, fetch, network };
}

describe("service worker", () => {
  it("API and /sync requests bypass the cache", async () => {
    const sw = loadSw();
    await sw.fire("install");
    sw.fetch.mockClear();
    sw.caches.open.mockClear();
    for (const req of [sw.get("/api/trips"), sw.get("/api/demo/friend-token"), sw.get("/sync"), sw.get("/api/auth/callback/x", "navigate")]) {
      expect(await sw.fire("fetch", req)).toBeUndefined();
    }
    expect(sw.fetch).not.toHaveBeenCalled();
    expect(sw.caches.open).not.toHaveBeenCalled();
    expect(sw.caches.match).not.toHaveBeenCalled();
  });

  it("navigations fall back to cache offline", async () => {
    const sw = loadSw();
    await sw.fire("install");
    // A trip page visited online is kept; then the network goes away.
    expect(await (await sw.fire("fetch", sw.get("/en/t/trip-1", "navigate")))!.text()).toBe(`network ${ORIGIN}/en/t/trip-1`);
    sw.network.online = false;

    const trip = await sw.fire("fetch", sw.get("/en/t/trip-1?friend=1", "navigate"));
    expect(await trip!.text()).toBe(`network ${ORIGIN}/en/t/trip-1`);
    const trips = await sw.fire("fetch", sw.get("/tr/trips", "navigate"));
    expect(await trips!.text()).toBe(`network ${ORIGIN}/tr/trips`);
    // Never visited: the offline page.
    const unknown = await sw.fire("fetch", sw.get("/en/t/trip-2", "navigate"));
    expect(await unknown!.text()).toBe(`network ${ORIGIN}/offline.html`);
  });

  it("tile cache evicts beyond 2000 entries", async () => {
    const sw = loadSw();
    const tile = (n: number) => sw.get(`https://tiles.openfreemap.org/planet/20260101/14/${n}/1.pbf`);
    for (let n = 0; n < 2005; n++) await sw.fire("fetch", tile(n));
    const tiles = [...sw.caches.store.entries()].find(([name]) => name.includes("tiles"))![1];
    const keys = (await tiles.keys()).map((k) => k.url);
    expect(keys).toHaveLength(2000);
    expect(keys[0]).toBe(tile(5).url);
    expect(keys.at(-1)).toBe(tile(2004).url);

    // Cache-first: a cached tile is served without the network, even offline.
    sw.network.online = false;
    expect(await (await sw.fire("fetch", tile(2004)))!.text()).toBe(`network ${tile(2004).url}`);
  });

  it("activate deletes the caches of older versions", async () => {
    const sw = loadSw();
    await sw.caches.open("rota-pages-v0");
    await sw.caches.open("someone-else");
    await sw.fire("install");
    await sw.fire("activate");
    const names = [...sw.caches.store.keys()];
    expect(names).not.toContain("rota-pages-v0");
    expect(names).toContain("someone-else");
    expect(names.some((n) => n.startsWith("rota-pages-"))).toBe(true);
  });

  it("each build has its own static cache, and the next build's worker deletes it", async () => {
    const first = loadSw({ build: "build-1" });
    await first.fire("install");
    await first.fire("activate");
    await first.fire("fetch", first.get("/_next/static/chunks/old.js"));
    await first.fire("fetch", first.get("https://tiles.openfreemap.org/planet/20260101/14/1/1.pbf"));

    const second = loadSw({ build: "build-2", caches: first.caches });
    await second.fire("install");
    await second.fire("activate");
    await second.fire("fetch", second.get("/_next/static/chunks/new.js"));
    const statics = [...second.caches.store.entries()].filter(([name]) => name.startsWith("rota-static-"));
    expect(statics).toHaveLength(1);
    expect((await statics[0][1].keys()).map((k) => k.url)).toEqual([`${ORIGIN}/_next/static/chunks/new.js`]);
    // Map tiles do not depend on the build: kept.
    expect([...second.caches.store.keys()]).toContain("rota-tiles");
  });

  it("a redirected page is not precached", async () => {
    const sw = loadSw();
    sw.network.redirects.add("/en/trips");
    await sw.fire("install");
    sw.network.online = false;
    // Offline, the redirect is not replayed (Chrome fails such a response); the offline page shows.
    const res = await sw.fire("fetch", sw.get("/en/trips", "navigate"));
    expect(await res!.text()).toBe(`network ${ORIGIN}/offline.html`);
  });

  it("the map style, TileJSON, glyphs and sprites are served stale while revalidated; only tiles are cache-first", async () => {
    const sw = loadSw();
    const assets = [
      "https://tiles.openfreemap.org/styles/liberty",
      "https://tiles.openfreemap.org/planet",
      "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf",
      "https://tiles.openfreemap.org/sprites/ofm_f384/ofm.json",
    ];
    for (const url of assets) expect(await (await sw.fire("fetch", sw.get(url)))!.text()).toBe(`network ${url}`);

    // The server moves on: the cached copy answers at once, and the new one replaces it for next time.
    sw.network.tag = " (new)";
    for (const url of assets) expect(await (await sw.fire("fetch", sw.get(url)))!.text()).toBe(`network ${url}`);
    for (const url of assets) expect(await (await sw.fire("fetch", sw.get(url)))!.text()).toBe(`network ${url} (new)`);

    // Offline, the last copy.
    sw.network.online = false;
    for (const url of assets) expect(await (await sw.fire("fetch", sw.get(url)))!.text()).toBe(`network ${url} (new)`);
    // None of them takes a place in the capped tile cache.
    const tiles = sw.caches.store.get("rota-tiles");
    expect(tiles ? await tiles.keys() : []).toEqual([]);
  });
});

describe("service worker registration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("registers /sw.js for the whole site in production only", () => {
    const register = vi.fn(async () => ({}));
    Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
    registerSw();
    expect(register).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "production");
    registerSw();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    Reflect.deleteProperty(navigator, "serviceWorker");
  });
});

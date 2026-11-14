import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSw } from "@/client/registerSw";

// public/sw.js runs as written, against a fake service worker global: `self` collects the event
// handlers, and `caches` / `fetch` are stand-ins the tests control.

const SOURCE = readFileSync(`${import.meta.dirname}/../../public/sw.js`, "utf8");
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

function loadSw() {
  const handlers: Record<string, (e: Event) => void> = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, handler: (e: Event) => void) => (handlers[type] = handler),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const caches = fakeCaches();
  const network = { online: true };
  const fetch = vi.fn(async (input: string | FakeRequest) => {
    if (!network.online) throw new TypeError("Failed to fetch");
    const url = typeof input === "string" ? new URL(input, ORIGIN).href : input.url;
    return new Response(`network ${url}`, { status: 200 });
  });
  new Function("self", "caches", "fetch", SOURCE)(self, caches, fetch);

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

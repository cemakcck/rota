import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as geocode } from "@/app/api/geocode/route";
import { GET as reverse } from "@/app/api/geocode/reverse/route";
import { GET as route } from "@/app/api/route/route";
import { GET as hours } from "@/app/api/hours/route";
import { GET as weather } from "@/app/api/weather/route";
import { addDaysToDate } from "@rota/trip";
import { resetThrottles, throttled, UpstreamBusy, USER_AGENT } from "@/server/proxy/upstream";
import { ORIGIN, signUpUser, type TestUser } from "./helpers";

// Upstream services are never called: `fetch` is stubbed for their hosts only.
const UPSTREAM = ["photon.komoot.io", "routing.openstreetmap.de", "overpass-api.de", "api.open-meteo.com"];
type Answer = (url: URL, init?: RequestInit) => Promise<Response> | Response;
const realFetch = globalThis.fetch;
let answer: Answer;
const upstream = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (!UPSTREAM.includes(url.host)) return realFetch(input, init);
  return Promise.resolve(answer(url, init));
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const upstreamCalls = () => upstream.mock.calls.filter(([input]) => UPSTREAM.includes(new URL(String(input)).host));

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let ip: string;
function get(handler: Handler, path: string, as: TestUser | null = ann): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": ip };
  if (as) headers.authorization = `Bearer ${as.token}`;
  return handler(new Request(`${ORIGIN}${path}`, { headers }), { params: Promise.resolve({}) });
}

let ann: TestUser;
beforeAll(async () => {
  ann = await signUpUser({ name: "Ann" });
});
beforeEach(() => {
  ip = randomIp();
  resetThrottles();
  upstream.mockClear();
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const unique = () => Math.random().toString(36).slice(2, 8);
const photonFeature = (props: Record<string, unknown>, [lng, lat]: [number, number]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: props,
});

describe("search", () => {
  it("search passes Turkish queries through intact", async () => {
    answer = () => json({ type: "FeatureCollection", features: [] });
    const res = await get(geocode, `/api/geocode?q=${encodeURIComponent("Kadıköy çarşı")}&lat=40.99&lng=29.03&lang=tr`);
    expect(res.status).toBe(200);
    const [input, init] = upstreamCalls()[0];
    const url = String(input);
    expect(url.startsWith("https://photon.komoot.io/api/?")).toBe(true);
    expect(url).toContain(`q=${encodeURIComponent("Kadıköy çarşı")}`);
    const params = new URL(url).searchParams;
    expect(params.get("q")).toBe("Kadıköy çarşı");
    expect(params.get("limit")).toBe("8");
    expect([params.get("lat"), params.get("lon")]).toEqual(["40.99", "29.03"]);
    // Turkish: no lang, so Photon returns the local names.
    expect(params.has("lang")).toBe(false);
    expect(new Headers(init?.headers).get("user-agent")).toBe(USER_AGENT);
  });

  it("search maps OSM tags to categories", async () => {
    const tags: [string, string, string][] = [
      ["amenity", "restaurant", "food"],
      ["amenity", "fast_food", "food"],
      ["amenity", "pub", "drinks"],
      ["amenity", "cafe", "cafe"],
      ["tourism", "gallery", "museum"],
      ["tourism", "viewpoint", "sight"],
      ["amenity", "place_of_worship", "sight"],
      ["amenity", "nightclub", "nightlife"],
      ["shop", "bakery", "shopping"],
      ["natural", "beach", "nature"],
      ["leisure", "fitness_centre", "gym"],
      ["tourism", "guest_house", "stay"],
      ["highway", "bus_stop", "other"],
    ];
    answer = () =>
      json({
        type: "FeatureCollection",
        features: tags.map(([key, value], i) =>
          photonFeature({ osm_type: "N", osm_id: i + 1, osm_key: key, osm_value: value, name: `${value} ${i}`, street: "İstiklal Caddesi", housenumber: "5", district: "Beyoğlu", city: "İstanbul", country: "Türkiye" }, [28.97, 41.03]),
        ),
      });
    const res = await get(geocode, `/api/geocode?q=${unique()}&lang=en`);
    const { results } = (await res.json()) as { results: { category: string; osmId: string; name: string; label: string; lat: number; lng: number }[] };
    expect(results.map((r) => r.category)).toEqual(tags.map((t) => t[2]));
    expect(results[0]).toEqual({ name: "restaurant 0", label: "İstiklal Caddesi 5, Beyoğlu, İstanbul, Türkiye", lat: 41.03, lng: 28.97, osmId: "n1", category: "food" });
    expect(new URL(String(upstreamCalls()[0][0])).searchParams.get("lang")).toBe("en");
  });

  it("the 61st search in a minute gets 429", async () => {
    answer = () => json({ type: "FeatureCollection", features: [] });
    const q = unique();
    for (let i = 0; i < 60; i++) expect((await get(geocode, `/api/geocode?q=${q}&lang=en`)).status).toBe(200);
    expect((await get(geocode, `/api/geocode?q=${q}&lang=en`)).status).toBe(429);
  });

  it("identical queries are served from cache", async () => {
    answer = () => json({ type: "FeatureCollection", features: [photonFeature({ osm_type: "W", osm_id: 7, osm_key: "tourism", osm_value: "museum", name: "Pera Müzesi" }, [28.975, 41.031])] });
    const q = `Pera ${unique()}`;
    const first = await (await get(geocode, `/api/geocode?q=${encodeURIComponent(q)}&lang=en`)).json();
    const second = await (await get(geocode, `/api/geocode?q=${encodeURIComponent(q)}&lang=en`)).json();
    expect(second).toEqual(first);
    expect(first.results[0]).toMatchObject({ osmId: "w7", category: "museum" });
    expect(upstreamCalls()).toHaveLength(1);
  });

  it("rejects queries shorter than 2 or longer than 100 characters", async () => {
    expect((await get(geocode, "/api/geocode?q=a&lang=en")).status).toBe(400);
    expect((await get(geocode, `/api/geocode?q=${"a".repeat(101)}&lang=en`)).status).toBe(400);
    expect(upstreamCalls()).toHaveLength(0);
  });

  it("reverse geocoding names a point", async () => {
    answer = () => json({ type: "FeatureCollection", features: [photonFeature({ osm_type: "N", osm_id: 3, name: "Galata Kulesi" }, [28.974, 41.0256])] });
    const res = await get(reverse, `/api/geocode/reverse?lat=41.0256&lng=28.${Math.floor(Math.random() * 1e6)}`);
    expect(await res.json()).toEqual({ name: "Galata Kulesi" });
    expect(String(upstreamCalls()[0][0])).toMatch(/^https:\/\/photon\.komoot\.io\/reverse\?/);
  });
});

describe("routing", () => {
  const osrm = {
    code: "Ok",
    routes: [
      {
        geometry: { type: "LineString", coordinates: [[28.97, 41.02], [28.975, 41.025], [28.98, 41.03]] },
        legs: [
          { duration: 600.4, distance: 800.2 },
          { duration: 300, distance: 410 },
        ],
      },
    ],
  };

  it("route returns legs and geometry and caches by coordinates", async () => {
    answer = () => json(osrm);
    const coords = `28.97,41.0${Math.floor(Math.random() * 1e4)};28.975,41.025;28.98,41.03`;
    const res = await get(route, `/api/route?mode=walk&coords=${coords}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      legs: [
        { seconds: 600, meters: 800 },
        { seconds: 300, meters: 410 },
      ],
      geometry: osrm.routes[0].geometry,
    });
    const url = new URL(String(upstreamCalls()[0][0]));
    expect(url.origin + url.pathname).toBe(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}`);
    expect(url.searchParams.get("overview")).toBe("full");
    expect(url.searchParams.get("geometries")).toBe("geojson");

    await get(route, `/api/route?mode=walk&coords=${coords}`);
    expect(upstreamCalls()).toHaveLength(1);
    // Driving is another route.
    await get(route, `/api/route?mode=drive&coords=${coords}`);
    expect(upstreamCalls()).toHaveLength(2);
    expect(String(upstreamCalls()[1][0])).toContain("/routed-car/route/v1/driving/");
  });

  it("rejects fewer than 2 or more than 25 coordinates", async () => {
    expect((await get(route, "/api/route?mode=walk&coords=28.97,41.02")).status).toBe(400);
    const many = Array.from({ length: 26 }, (_, i) => `28.9${i},41.0`).join(";");
    expect((await get(route, `/api/route?mode=walk&coords=${many}`)).status).toBe(400);
    expect((await get(route, "/api/route?mode=fly&coords=28.97,41.02;28.98,41.03")).status).toBe(400);
  });

  it("route upstream timeout → 503", async () => {
    // Never answers; only the proxy's own timeout ends the request.
    answer = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const started = Date.now();
    const res = await get(route, `/api/route?mode=drive&coords=29.0${Math.floor(Math.random() * 1e4)},41.0;29.01,41.01`);
    expect(res.status).toBe(503);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
  }, 10_000);

  it("route upstream error → 503", async () => {
    answer = () => json({ code: "NoRoute" }, 400);
    const res = await get(route, `/api/route?mode=walk&coords=29.1${Math.floor(Math.random() * 1e4)},41.0;29.11,41.01`);
    expect(res.status).toBe(503);
  });
});

describe("upstream", () => {
  it("a second upstream call within 1 s waits; one that would wait over 2 s fails fast", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const at: number[] = [];
    answer = () => {
      at.push(Date.now());
      return json({ ok: true });
    };
    const call = throttled("photon");
    const t0 = Date.now();
    await call("https://photon.komoot.io/api/?q=a");
    const second = call("https://photon.komoot.io/api/?q=b");
    const third = call("https://photon.komoot.io/api/?q=c");
    // Would start 3 s from now: refused without waiting.
    await expect(call("https://photon.komoot.io/api/?q=d")).rejects.toBeInstanceOf(UpstreamBusy);
    expect(at).toEqual([t0]);
    await vi.advanceTimersByTimeAsync(1000);
    await second;
    expect(at).toEqual([t0, t0 + 1000]);
    await vi.advanceTimersByTimeAsync(1000);
    await third;
    expect(at).toEqual([t0, t0 + 1000, t0 + 2000]);
  });
});

describe("opening hours", () => {
  it("hours batches ids into one Overpass query", async () => {
    const n = Math.floor(Math.random() * 1e9);
    answer = () =>
      json({
        elements: [
          { type: "node", id: n, tags: { name: "Pera", opening_hours: "Tu-Su 10:00-19:00" } },
          { type: "way", id: n + 1, tags: { name: "Park" } },
        ],
      });
    const ids = [`n${n}`, `w${n + 1}`, `r${n + 2}`];
    const res = await get(hours, `/api/hours?ids=${ids.join(",")}`);
    expect(await res.json()).toEqual({ hours: { [`n${n}`]: "Tu-Su 10:00-19:00", [`w${n + 1}`]: null, [`r${n + 2}`]: null } });
    expect(upstreamCalls()).toHaveLength(1);
    const url = new URL(String(upstreamCalls()[0][0]));
    expect(url.origin + url.pathname).toBe("https://overpass-api.de/api/interpreter");
    const query = url.searchParams.get("data")!;
    expect(query).toContain(`node(id:${n})`);
    expect(query).toContain(`way(id:${n + 1})`);
    expect(query).toContain(`relation(id:${n + 2})`);
    expect(query).toContain("out tags;");

    // Cached ids are not asked again; only the new one is.
    await get(hours, `/api/hours?ids=n${n},n${n + 3}`);
    expect(upstreamCalls()).toHaveLength(2);
    expect(new URL(String(upstreamCalls()[1][0])).searchParams.get("data")).not.toContain(`id:${n})`);
  });

  it("rejects more than 25 ids and malformed ids", async () => {
    const many = Array.from({ length: 26 }, (_, i) => `n${i + 1}`).join(",");
    expect((await get(hours, `/api/hours?ids=${many}`)).status).toBe(400);
    expect((await get(hours, "/api/hours?ids=x1")).status).toBe(400);
  });
});

describe("weather", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("weather beyond 16 days returns availableFrom", async () => {
    const start = addDaysToDate(today, 30);
    const res = await get(weather, `/api/weather?lat=41.01&lng=28.97&start=${start}&end=${addDaysToDate(start, 2)}`);
    expect(await res.json()).toEqual({ days: [], availableFrom: addDaysToDate(start, -15) });
    expect(upstreamCalls()).toHaveLength(0);
  });

  it("weather within the forecast returns the days, and later days when they become available", async () => {
    const start = addDaysToDate(today, 14);
    const dates = [start, addDaysToDate(start, 1)];
    answer = () =>
      json({
        daily: { time: dates, weather_code: [3, 61], temperature_2m_max: [14.4, 12.6], temperature_2m_min: [8.1, 7], precipitation_probability_max: [10, 80] },
      });
    const lat = `41.0${Math.floor(Math.random() * 1e4)}`;
    const res = await get(weather, `/api/weather?lat=${lat}&lng=28.97&start=${start}&end=${addDaysToDate(start, 3)}`);
    expect(await res.json()).toEqual({
      days: [
        { date: dates[0], code: 3, max: 14, min: 8, rain: 10 },
        { date: dates[1], code: 61, max: 13, min: 7, rain: 80 },
      ],
      availableFrom: addDaysToDate(today, 1),
    });
    const url = new URL(String(upstreamCalls()[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe(String(Math.round(Number(lat) * 100) / 100));
    expect(url.searchParams.get("daily")).toBe("weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    expect(url.searchParams.get("timezone")).toBe("auto");
    expect([url.searchParams.get("start_date"), url.searchParams.get("end_date")]).toEqual([start, addDaysToDate(today, 15)]);
  });
});

describe("sessions", () => {
  it("proxy routes require a session", async () => {
    const paths: [Handler, string][] = [
      [geocode, "/api/geocode?q=Galata&lang=en"],
      [reverse, "/api/geocode/reverse?lat=41&lng=29"],
      [route, "/api/route?mode=walk&coords=28.97,41.02;28.98,41.03"],
      [hours, "/api/hours?ids=n1"],
      [weather, "/api/weather?lat=41&lng=29&start=2027-01-01&end=2027-01-02"],
    ];
    for (const [handler, path] of paths) expect((await get(handler, path, null)).status, path).toBe(401);
    expect(upstreamCalls()).toHaveLength(0);
  });
});

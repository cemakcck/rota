import { randomUUID } from "node:crypto";
import { test as base, devices, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_URL } from "./env";

/** A style with no sources: MapLibre starts (pins, cursors) without any tile server. */
const EMPTY_STYLE = { version: 8, sources: {}, layers: [{ id: "paper", type: "background", paint: { "background-color": "#efece6" } }] };

/**
 * Nothing leaves the machine: OpenFreeMap gets the empty style (tiles: 204), and our own proxies for
 * search, routes, opening hours and weather answer with stubs instead of calling their upstreams.
 * Routed on the context, so the service worker's fetches are covered too.
 */
export async function stubNetwork(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.hostname === "tiles.openfreemap.org",
    (route) => (new URL(route.request().url()).pathname.startsWith("/styles/") ? route.fulfill({ json: EMPTY_STYLE }) : route.fulfill({ status: 204 })),
  );
  const api = (path: string) => (url: URL) => url.origin === E2E_URL && url.pathname === path;
  await context.route(api("/api/geocode"), (route) => route.fulfill({ json: { results: [] } }));
  await context.route(api("/api/geocode/reverse"), (route) => route.fulfill({ json: { name: null } }));
  await context.route(api("/api/hours"), (route) => route.fulfill({ json: { hours: {} } }));
  await context.route(api("/api/weather"), (route) => route.fulfill({ json: { days: [], availableFrom: null } }));
  await context.route(api("/api/route"), (route) => {
    // A straight line between the stops, ten minutes a leg.
    const coords = (new URL(route.request().url()).searchParams.get("coords") ?? "").split(";").map((p) => p.split(",").map(Number));
    const legs = coords.slice(1).map(() => ({ seconds: 600, meters: 800 }));
    return route.fulfill({ json: { legs, geometry: { type: "LineString", coordinates: coords } } });
  });
}

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
/** Better Auth and our API refuse cross-site writes; a sign-up IP of its own keeps the per-IP limit out of the way. */
const writeHeaders = () => ({ origin: E2E_URL, "x-forwarded-for": randomIp() });

export type Person = { id: string; name: string; email: string; context: BrowserContext; page: Page };

export async function newContext(browser: Browser, viewport = { width: 1280, height: 800 }): Promise<BrowserContext> {
  const context = await browser.newContext({ ...devices["Desktop Chrome"], viewport, baseURL: E2E_URL });
  await stubNetwork(context);
  return context;
}

export const PASSWORD = "correct-horse-1";

/** A new account, signed in in a browser context of its own. */
export async function signUp(browser: Browser, name: string, colour = "#2563eb"): Promise<Person> {
  const context = await newContext(browser);
  const email = `${name.toLowerCase()}-${randomUUID()}@e2e.rota`;
  const res = await context.request.post("/api/auth/sign-up/email", { headers: writeHeaders(), data: { name, email, password: PASSWORD, colour } });
  expect(res.status(), await res.text()).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  return { id: user.id, name, email, context, page: await context.newPage() };
}

export async function api(person: Person, method: "POST" | "DELETE" | "PATCH", path: string, data?: object) {
  const res = await person.context.request.fetch(path, { method, headers: writeHeaders(), data });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

/** A trip owned by `owner`, joined by each of `members` through a join link. */
export async function tripWith(owner: Person, ...members: Person[]): Promise<string> {
  const { id } = (await api(owner, "POST", "/api/trips", { name: "Lisbon weekend", startDate: "2027-05-01", days: 2, locale: "en" })) as { id: string };
  if (members.length > 0) {
    const { token } = (await api(owner, "POST", `/api/trips/${id}/invites`, { kind: "link" })) as { token: string };
    for (const m of members) await api(m, "POST", `/api/invites/${token}`);
  }
  return id;
}

/** Opens the trip and waits for its first sync. */
export async function openTrip(page: Page, tripId: string): Promise<void> {
  await page.goto(`/en/t/${tripId}`);
  await expect(syncIndicator(page)).toHaveText("Synced");
}

export const syncIndicator = (page: Page) => page.getByRole("banner").getByText(/^(Synced|Syncing…|Offline — .*)$/);

/** Adds a place by name, to Day 1 unless another list is named. */
export async function addPlace(page: Page, name: string, list = "Day 1"): Promise<void> {
  await page.getByRole("combobox", { name: "Place name" }).fill(name);
  await page.getByLabel("Add to").selectOption({ label: list });
  await page.getByRole("form", { name: "Add a place" }).getByRole("button", { name: "Add", exact: true }).click();
}

/** The names of the places planned on day `n`, in order. */
export async function dayPlaces(page: Page, n: number): Promise<string[]> {
  const links = page.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) }).getByRole("link", { name: /^Open in Google Maps — / });
  const names = await links.evaluateAll((els) => els.map((el) => el.textContent ?? ""));
  return names.map((text) => text.replace(/^.*Open in Google Maps\s*— /, "").replace(/ \(opens in a new tab\)$/, "").trim());
}

/** Starts a demo for this context's browser, as the landing page does, and returns the trip id. */
export async function startDemo(context: BrowserContext): Promise<string> {
  const res = await context.request.post("/api/demo", { headers: writeHeaders(), data: { locale: "en" } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { tripId: string }).tripId;
}

export const placeInList = (page: Page, name: string) => page.getByRole("main").getByText(name, { exact: true });

/** People made with `signUp` get their contexts closed after the test. */
export const test = base.extend<{ people: { signUp(name: string, colour?: string): Promise<Person> } }>({
  // Playwright's fixture callback is conventionally `use`; named otherwise so lint does not take it for React's.
  context: async ({ context }, provide) => {
    await stubNetwork(context);
    await provide(context);
  },
  people: async ({ browser }, provide) => {
    const made: Person[] = [];
    await provide({
      async signUp(name, colour) {
        const person = await signUp(browser, name, colour);
        made.push(person);
        return person;
      },
    });
    for (const p of made) await p.context.close();
  },
});

export { expect };

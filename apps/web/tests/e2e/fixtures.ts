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

/**
 * Marks the first-time tour seen for whoever is signed in to `context`, so a trip opens straight to the
 * plan (the tour is a modal: it hides the rest of the screen from the accessibility tree). tour.spec.ts
 * is the one place the tour itself is tested.
 */
export async function skipTourFor(context: BrowserContext): Promise<void> {
  const res = await context.request.put("/api/profile/tips", { headers: writeHeaders() });
  expect(res.ok(), `PUT /api/profile/tips: ${res.status()} ${await res.text()}`).toBe(true);
}

/** A new account, signed in in a browser context of its own; it has seen the tour unless `tour` is set. */
export async function signUp(browser: Browser, name: string, colour = "#2563eb", { tour = false } = {}): Promise<Person> {
  const context = await newContext(browser);
  const email = `${name.toLowerCase()}-${randomUUID()}@e2e.rota`;
  const res = await context.request.post("/api/auth/sign-up/email", { headers: writeHeaders(), data: { name, email, password: PASSWORD, colour } });
  expect(res.status(), await res.text()).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  if (!tour) await skipTourFor(context);
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

/** The header's avatars of who is in the trip now (inside the people button, which they name). */
export const hereNow = (page: Page) => page.getByRole("banner").getByRole("button", { name: /^People: .*\. In this trip now:/ });

export const syncIndicator = (page: Page) => page.getByRole("banner").getByText(/^(Synced|Syncing…|Offline — .*)$/);

/** Adds a place by name (no time), to Day 1 (the day shown) unless another list ("Ideas") is named. */
export async function addPlace(page: Page, name: string, list = "Day 1"): Promise<void> {
  await addPlaceAt(page, name, "", list);
}

/** Adds a place by name at `time` ("HH:MM", or "" for none) through the add step, to the day shown. */
export async function addPlaceAt(page: Page, name: string, time: string, list = "Day 1"): Promise<void> {
  const search = page.getByRole("combobox", { name: /^Add a place to / });
  await search.fill(name);
  await search.press("Enter");
  const step = page.getByRole("form", { name: `Add ${name}` });
  await step.getByLabel("Time").fill(time);
  await step.getByRole("button", { name: `Add to ${list}`, exact: true }).click();
  await expect(step).toBeHidden();
}

/** The names of the places planned on day `n`, in order (the day must be shown). */
export async function dayPlaces(page: Page, n: number): Promise<string[]> {
  return page.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) }).getByTestId("place-name").allTextContents();
}

/** Starts a demo for this context's browser, as the landing page does, and returns the trip id; its guest has seen the tour unless `tour` is set. */
export async function startDemo(context: BrowserContext, { tour = false } = {}): Promise<string> {
  const res = await context.request.post("/api/demo", { headers: writeHeaders(), data: { locale: "en" } });
  expect(res.status(), await res.text()).toBe(201);
  if (!tour) await skipTourFor(context);
  return ((await res.json()) as { tripId: string }).tripId;
}

export const placeInList = (page: Page, name: string) => page.getByRole("main").getByText(name, { exact: true });

/** People made with `signUp` get their contexts closed after the test. */
export const test = base.extend<{ people: { signUp(name: string, colour?: string, options?: { tour?: boolean }): Promise<Person> } }>({
  // Playwright's fixture callback is conventionally `use`; named otherwise so lint does not take it for React's.
  context: async ({ context }, provide) => {
    await stubNetwork(context);
    await provide(context);
  },
  people: async ({ browser }, provide) => {
    const made: Person[] = [];
    await provide({
      async signUp(name, colour, options) {
        const person = await signUp(browser, name, colour, options);
        made.push(person);
        return person;
      },
    });
    for (const p of made) await p.context.close();
  },
});

export { expect };

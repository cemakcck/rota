/**
 * The README's screenshots and two-window GIF (docs/screenshots), taken from a running server:
 *
 *   npm run dev                                  # http://localhost:3400, in another terminal
 *   npx tsx scripts/screenshots.ts               # from apps/web
 *
 * By default the map loads real OpenFreeMap tiles and the proxies call their real services (search,
 * routes, opening hours, weather), so the pictures look like the app does. STUB=1 stubs them the way
 * the end-to-end suite does (a blank map, straight-line routes), for runs without a network.
 * BASE_URL points it at another server. The GIF needs ImageMagick (`convert`).
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BASE = (process.env.BASE_URL ?? "http://localhost:3400").replace(/\/$/, "");
const STUB = process.env.STUB === "1";
const OUT = path.join(import.meta.dirname, "../../../docs/screenshots");
const EMPTY_STYLE = { version: 8, sources: {}, layers: [{ id: "paper", type: "background", paint: { "background-color": "#efece6" } }] };

async function stub(context: BrowserContext): Promise<void> {
  if (!STUB) return;
  await context.route(
    (url) => url.hostname === "tiles.openfreemap.org",
    (route) => (new URL(route.request().url()).pathname.startsWith("/styles/") ? route.fulfill({ json: EMPTY_STYLE }) : route.fulfill({ status: 204 })),
  );
  const api = (p: string) => (url: URL) => url.origin === BASE && url.pathname === p;
  await context.route(api("/api/geocode"), (route) => route.fulfill({ json: { results: [] } }));
  await context.route(api("/api/hours"), (route) => route.fulfill({ json: { hours: {} } }));
  await context.route(api("/api/weather"), (route) => route.fulfill({ json: { days: [], availableFrom: null } }));
  await context.route(api("/api/route"), (route) => {
    const coords = (new URL(route.request().url()).searchParams.get("coords") ?? "").split(";").map((p) => p.split(",").map(Number));
    const legs = coords.slice(1).map(() => ({ seconds: 600, meters: 800 }));
    return route.fulfill({ json: { legs, geometry: { type: "LineString", coordinates: coords } } });
  });
}

async function newContext(browser: Browser, viewport: { width: number; height: number }, mobile = false): Promise<BrowserContext> {
  const device = mobile ? devices["Pixel 7"] : devices["Desktop Chrome"];
  const context = await browser.newContext({ ...device, viewport, deviceScaleFactor: mobile ? 2 : 1, baseURL: BASE, locale: "en-US", timezoneId: "Europe/Istanbul" });
  await stub(context);
  return context;
}

const indicator = (page: Page) => page.getByRole("banner").getByText(/^(Synced|Syncing…|Offline — .*)$/);

/** Landing → "Try the demo" → the trip, synced, with the map drawn. */
async function startDemo(page: Page): Promise<void> {
  await page.goto("/en");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("heading", { name: "Istanbul long weekend" })).toBeVisible({ timeout: 30_000 });
  await expect(indicator(page)).toHaveText("Synced", { timeout: 30_000 });
  await settle(page);
}

/** Lets tiles, routes and fonts arrive. */
async function settle(page: Page, ms = 2500): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

async function addPlace(page: Page, name: string): Promise<void> {
  await page.getByRole("combobox", { name: "Place name" }).fill(name);
  await page.getByLabel("Add to").selectOption({ label: "Day 1" });
  await page.getByRole("form", { name: "Add a place" }).getByRole("button", { name: "Add", exact: true }).click();
}

/** Scrolls the list so `name` (once it is there) is in view. */
async function reveal(page: Page, name: string): Promise<void> {
  const row = page.getByRole("main").getByText(name, { exact: true });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, name) });

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    // 1. Landing page.
    const landing = await newContext(browser, { width: 1280, height: 800 });
    const lp = await landing.newPage();
    await lp.goto("/en");
    await settle(lp, 1500);
    await shot(lp, "landing.png");
    await landing.close();

    // 2. The demo trip with Selin, the scripted friend, dropping in.
    const desk = await newContext(browser, { width: 1440, height: 900 });
    const page = await desk.newPage();
    await startDemo(page);
    const selin = page.getByRole("list", { name: "In this trip now" }).getByRole("img", { name: "Selin" });
    await expect(selin).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-cursor]", { hasText: "Selin" })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await shot(page, "trip.png");
    await desk.close();

    // 3. Phone layout.
    const phone = await newContext(browser, { width: 390, height: 844 }, true);
    const pp = await phone.newPage();
    await startDemo(pp);
    await shot(pp, "phone.png");
    await phone.close();

    // 4. Two windows: the visitor and Deniz. Frames for the GIF, plus the offline still.
    const size = { width: 1040, height: 720 };
    const two = await newContext(browser, size);
    const me = await two.newPage();
    await startDemo(me);
    const opened = me.waitForEvent("popup");
    await me.getByRole("button", { name: "Try it with a friend" }).click();
    const deniz = await opened;
    await deniz.setViewportSize(size);
    await expect(deniz.getByText("You're Deniz in this window")).toBeVisible({ timeout: 30_000 });
    await expect(indicator(deniz)).toHaveText("Synced", { timeout: 30_000 });
    await settle(deniz);

    const frames = await mkdtemp(path.join(tmpdir(), "rota-gif-"));
    const sequence: { file: string; delay: number }[] = [];
    const frame = async (delay: number) => {
      const n = String(sequence.length).padStart(2, "0");
      const left = path.join(frames, `${n}-a.png`);
      const right = path.join(frames, `${n}-b.png`);
      await me.screenshot({ path: left });
      await deniz.screenshot({ path: right });
      const file = path.join(frames, `${n}.png`);
      execFileSync("convert", [left, right, "+append", "+repage", file]);
      sequence.push({ file, delay });
    };

    await frame(150);
    // Live: an edit in one window shows in the other.
    await addPlace(me, "Pera Museum");
    await reveal(me, "Pera Museum");
    await reveal(deniz, "Pera Museum");
    await frame(200);
    // Offline: both edit, the visitor's changes wait.
    const simulate = me.getByRole("switch", { name: "Simulate offline" });
    await simulate.click();
    await expect(indicator(me)).toHaveText("Offline — no changes waiting");
    await frame(150);
    await addPlace(me, "SALT Galata");
    await reveal(me, "SALT Galata");
    await addPlace(deniz, "Arter");
    await reveal(deniz, "Arter");
    await expect(indicator(me)).toHaveText("Offline — 1 change waiting");
    await frame(250);
    await shot(me, "offline.png");
    // Back online: both windows merge to the same list.
    await simulate.click();
    await expect(indicator(me)).toHaveText("Synced", { timeout: 15_000 });
    await reveal(me, "Arter");
    await reveal(deniz, "SALT Galata");
    await settle(me, 1500);
    await frame(400);
    await two.close();

    // Side by side still, and the GIF at half size.
    execFileSync("convert", [sequence.at(-1)!.file, "-resize", "1600x", path.join(OUT, "two-windows.png")]);
    const args = ["-loop", "0"];
    for (const { file, delay } of sequence) args.push("-delay", String(delay), file);
    args.push("+repage", "-resize", "1280x", "-layers", "Optimize", "-colors", "128", path.join(OUT, "two-windows.gif"));
    execFileSync("convert", args);
    await rm(frames, { recursive: true, force: true });
  } finally {
    await browser.close();
  }
  console.log(`Screenshots in ${OUT}`);
}

await main();

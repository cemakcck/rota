import type { Page } from "@playwright/test";
import { dayPlaces, expect, openTrip, startDemo, test } from "./fixtures";

const PHONE = { width: 390, height: 844 };
const tabs = (page: Page) => page.getByRole("navigation", { name: "Trip views" });
const tab = (page: Page, name: string) => tabs(page).getByRole("button", { name, exact: true });
const chips = (page: Page) => page.getByRole("navigation", { name: "Days" });
const chip = (page: Page, n: number) => chips(page).getByRole("button", { name: new RegExp(`^Day ${n} · `) });
const day = (page: Page, n: number) => page.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) });
const mapSection = (page: Page) => page.getByRole("region", { name: "Map", exact: true });

// The demo's first stop (packages/trip/src/seed.ts): Day 1, 08:30, at 41.0226, 28.9776.
const FIRST = { name: "Karaköy Güllüoğlu", maps: "https://www.google.com/maps/search/?api=1&query=41.0226,28.9776" };

/** The demo trip on a phone (touch), plan tab, map started. */
async function openPhoneDemo(page: Page, tripId: string) {
  await openTrip(page, tripId);
  await expect(page.locator("canvas.maplibregl-canvas")).toHaveCount(1);
  await expect(tab(page, "Plan")).toHaveAttribute("aria-current", "true");
}

test.describe("phone layout (390×844)", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("the tabs switch between the plan, the map, Ideas and the checklist", async ({ context, page }) => {
    const tripId = await startDemo(context);
    await openPhoneDemo(page, tripId);
    await expect(page.getByRole("main", { name: "Plan" })).toBeVisible();
    await expect(day(page, 1)).toBeVisible();
    await expect(mapSection(page)).toBeHidden();

    await tab(page, "Map").click();
    await expect(tab(page, "Map")).toHaveAttribute("aria-current", "true");
    await expect(mapSection(page)).toBeVisible();
    await expect(page.getByRole("main")).toBeHidden();

    await tab(page, "Ideas").click();
    await expect(tab(page, "Ideas")).toHaveAttribute("aria-current", "true");
    await expect(page).toHaveURL(/\?view=ideas$/);
    await expect(page.getByRole("region", { name: "Suggestions" })).toContainText("Moda Sahil");

    await tab(page, "Checklist").click();
    await expect(tab(page, "Checklist")).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("main", { name: "Checklist" }).getByRole("list", { name: "Checklist items" })).toBeVisible();

    await tab(page, "Plan").click();
    await expect(day(page, 1)).toBeVisible();
  });

  test("the day chips keep the chosen day across tabs; ＋ takes focus to the search", async ({ context, page }) => {
    await openPhoneDemo(page, await startDemo(context));
    await chip(page, 2).click();
    await expect(chip(page, 2)).toHaveAttribute("aria-current", "true");
    await expect(day(page, 2)).toBeVisible();
    await expect(day(page, 1)).toHaveCount(0);
    const dayTwo = await dayPlaces(page, 2);
    expect(dayTwo.length).toBeGreaterThan(0);

    // Away to the map and to Ideas, then back to the plan: still Day 2.
    await tab(page, "Map").click();
    await expect(chip(page, 2)).toHaveAttribute("aria-current", "true");
    await tab(page, "Ideas").click();
    await tab(page, "Plan").click();
    await expect(chip(page, 2)).toHaveAttribute("aria-current", "true");
    await expect.poll(() => dayPlaces(page, 2)).toEqual(dayTwo);

    await page.getByRole("button", { name: "Add place", exact: true }).click();
    await expect(page.getByRole("combobox", { name: /^Add a place to Day 2/ })).toBeFocused();
  });

  test("a pin on the map shows its card; Details opens the sheet with the rest inert", async ({ context, page }) => {
    await openPhoneDemo(page, await startDemo(context));
    const id = (await page.getByRole("main").getByRole("button", { name: FIRST.name, exact: true }).getAttribute("id"))!.replace(/^place-open-/, "");
    await tab(page, "Map").click();
    await page.locator(`[data-pin="${id}"]`).tap();

    const card = page.getByRole("region", { name: FIRST.name });
    await expect(card.getByTestId("pin-card-facts")).toContainText("08:30");
    await expect(card.getByRole("link", { name: /^Google Maps/ })).toHaveAttribute("href", FIRST.maps);
    await expect(card.getByRole("link", { name: /^Google Maps/ })).toHaveAttribute("target", "_blank");

    await card.getByRole("button", { name: "Details", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: `Details for ${FIRST.name}` });
    await expect(sheet.getByLabel("Arrive")).toHaveValue("08:30");
    // Behind the sheet: header, map and tabs are inert (no focus, no taps, hidden from screen readers).
    for (const behind of [page.locator("header"), page.locator("canvas.maplibregl-canvas"), page.locator("nav").filter({ hasText: "Checklist" })]) {
      await expect.poll(() => behind.first().evaluate((el) => el.closest("[inert]") !== null)).toBe(true);
    }
    expect(await sheet.evaluate((el) => el.closest("[inert]") === null)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    // Back on the card it came from.
    await expect(card.getByRole("button", { name: "Details", exact: true })).toBeFocused();
    await expect.poll(() => page.locator("header").evaluate((el) => el.closest("[inert]") === null)).toBe(true);
  });

  test("a resize to desktop and back keeps the view, the selected stop and its open details", async ({ context, page }) => {
    await openPhoneDemo(page, await startDemo(context));
    await chip(page, 2).click();
    const name = (await day(page, 2).getByTestId("place-name").first().textContent())!;
    const row = page.getByRole("main").getByRole("listitem").filter({ has: page.getByTestId("place-name").getByText(name, { exact: true }) });
    await day(page, 2).getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("dialog", { name: `Details for ${name}` })).toBeVisible();
    const url = page.url();

    await page.setViewportSize({ width: 1280, height: 800 });
    // Desktop: the rail instead of the chips, the details as a side panel (not modal).
    const rail = page.getByRole("navigation", { name: "Trip" });
    await expect(rail.getByRole("button", { name: /^Day 2 · / })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("region", { name: `Details for ${name}` })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row).toHaveAttribute("aria-current", "true");
    expect(page.url()).toBe(url);

    await page.setViewportSize(PHONE);
    await expect(chip(page, 2)).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("dialog", { name: `Details for ${name}` })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row).toHaveAttribute("aria-current", "true");
    expect(page.url()).toBe(url);
  });
});

import { dayPlaces, expect, hereNow, openTrip, startDemo, syncIndicator, test } from "./fixtures";

test.describe("demo", () => {
  test("landing → Try the demo → the Istanbul trip loads with 12 places", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Try the demo" }).click();
    await expect(page).toHaveURL(/\/en\/t\/[A-Za-z0-9]{22}$/);
    // A new guest: the first-time tour opens; skipped, the plan is there.
    const tour = page.getByRole("dialog", { name: "These are your days" });
    await tour.getByRole("button", { name: "Skip tour" }).click();
    await expect(tour).toBeHidden();
    await expect(page.getByRole("heading", { name: "Istanbul long weekend" })).toBeVisible();
    await expect(syncIndicator(page)).toHaveText("Synced");
    await page.getByRole("navigation", { name: "Trip" }).getByRole("button", { name: "Whole trip on map" }).click();
    await expect(page).toHaveURL(/\?view=all$/);
    await expect.poll(async () => (await Promise.all([1, 2, 3].map((n) => dayPlaces(page, n)))).flat().length).toBe(12);
  });

  test("Try it with a friend opens a second window as Deniz", async ({ context, page }) => {
    await openTrip(page, await startDemo(context));
    const opened = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Try it with a friend" }).click();
    const deniz = await opened;
    await expect(deniz.getByText("You're Deniz in this window")).toBeVisible();
    await expect(deniz.getByRole("heading", { name: "Istanbul long weekend" })).toBeVisible();
    await expect(syncIndicator(deniz)).toHaveText("Synced");
    // Each window sees the other person here.
    await expect(hereNow(page).getByRole("img", { name: "Deniz" })).toBeVisible();
    await expect(hereNow(deniz).getByRole("img", { name: /^Guest / })).toBeVisible();
  });

  test("Selin drops in and leaves", async ({ context, page }) => {
    await openTrip(page, await startDemo(context));
    const here = hereNow(page);
    const selin = here.getByRole("img", { name: "Selin" });
    await expect(selin).toBeVisible({ timeout: 15_000 });
    // Her cursor crosses the map, she adds to the note of Day 1's second stop (seen in its details), votes and ticks an item.
    await expect(page.locator("[data-cursor]", { hasText: "Selin" })).toBeVisible();
    const second = page.getByRole("region", { name: /^Day 1\b/ }).getByTestId("place-name").nth(1);
    const name = await second.textContent();
    await second.click();
    await expect(page.getByRole("region", { name: `Details for ${name}` }).getByText("Let's go early, it gets busy after 11.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Trip" }).getByRole("button", { name: /^Checklist/ })).toContainText("3/5", { timeout: 15_000 });
    await expect(selin).toHaveCount(0, { timeout: 15_000 });
  });
});

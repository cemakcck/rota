import { dayPlaces, expect, openTrip, startDemo, syncIndicator, test } from "./fixtures";

test.describe("demo", () => {
  test("landing → Try the demo → the Istanbul trip loads with 12 places", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Try the demo" }).click();
    await expect(page).toHaveURL(/\/en\/t\/[A-Za-z0-9]{22}$/);
    await expect(page.getByRole("heading", { name: "Istanbul long weekend" })).toBeVisible();
    await expect(syncIndicator(page)).toHaveText("Synced");
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
    await expect(page.getByRole("list", { name: "In this trip now" }).getByRole("img", { name: "Deniz" })).toBeVisible();
    await expect(deniz.getByRole("list", { name: "In this trip now" }).getByRole("img", { name: /^Guest / })).toBeVisible();
  });

  test("Selin drops in and leaves", async ({ context, page }) => {
    await openTrip(page, await startDemo(context));
    const here = page.getByRole("list", { name: "In this trip now" });
    const selin = here.getByRole("img", { name: "Selin" });
    await expect(selin).toBeVisible({ timeout: 15_000 });
    // Her cursor crosses the map, she adds to a note, votes and ticks an item.
    await expect(page.locator("[data-cursor]", { hasText: "Selin" })).toBeVisible();
    await expect(page.getByText("Let's go early, it gets busy after 11.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: /Checklist/ })).toContainText("3/5", { timeout: 15_000 });
    await expect(selin).toHaveCount(0, { timeout: 15_000 });
  });
});

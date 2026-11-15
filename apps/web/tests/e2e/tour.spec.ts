import { expect, newContext, openTrip, syncIndicator, test, tripWith } from "./fixtures";

// The one spec that meets the first-time tour: everyone else has seen it (see `skipTourFor`).
test.describe("first-time tour", () => {
  test("shows on the first open, steps forward and back, and once skipped stays away", async ({ browser, people }) => {
    const ann = await people.signUp("Ann", undefined, { tour: true });
    const { page } = ann;
    const tripId = await tripWith(ann);
    await page.goto(`/en/t/${tripId}`);

    const tour = page.getByRole("dialog");
    await expect(tour).toHaveAccessibleName("These are your days");
    await expect(tour).toHaveAccessibleDescription("Step 1 of 3");
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour).toHaveAccessibleName("Add a place — pick a time before it goes in");
    await expect(tour).toHaveAccessibleDescription("Step 2 of 3");
    await tour.getByRole("button", { name: "Back" }).click();
    await expect(tour).toHaveAccessibleName("These are your days");

    await tour.getByRole("button", { name: "Skip tour" }).click();
    await expect(tour).toBeHidden();
    await expect(syncIndicator(page)).toHaveText("Synced");

    // Remembered for this person on the server: another device (same account, nothing stored there) does not show it.
    await expect.poll(async () => (await ann.context.request.get("/api/profile/tips")).json()).toEqual({ seen: true });
    const device = await newContext(browser);
    try {
      await device.addCookies(await ann.context.cookies());
      const other = await device.newPage();
      const asked = other.waitForResponse((r) => r.url().endsWith("/api/profile/tips") && r.request().method() === "GET");
      await openTrip(other, tripId);
      expect(await (await asked).json()).toEqual({ seen: true });
      await expect(other.getByRole("dialog")).toHaveCount(0);
      await expect(other.getByRole("heading", { name: "Lisbon weekend" })).toBeVisible();
    } finally {
      await device.close();
    }
  });
});

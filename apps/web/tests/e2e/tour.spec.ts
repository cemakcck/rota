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

  test("Done after the third step, then Show tips again brings it back on the next open", async ({ people }) => {
    const ann = await people.signUp("Ann", undefined, { tour: true });
    const { page } = ann;
    const tripId = await tripWith(ann);
    await page.goto(`/en/t/${tripId}`);

    const tour = page.getByRole("dialog");
    const steps = [
      ["These are your days", "Step 1 of 3"],
      ["Add a place — pick a time before it goes in", "Step 2 of 3"],
      ["Invite friends to plan together", "Step 3 of 3"],
    ];
    for (const [i, [title, progress]] of steps.entries()) {
      await expect(tour).toHaveAccessibleName(title);
      await expect(tour).toHaveAccessibleDescription(progress);
      if (i < steps.length - 1) await tour.getByRole("button", { name: "Next" }).click();
    }
    await expect(tour.getByRole("button", { name: "Next" })).toHaveCount(0);
    await tour.getByRole("button", { name: "Done" }).click();
    await expect(tour).toBeHidden();
    await expect.poll(async () => (await ann.context.request.get("/api/profile/tips")).json()).toEqual({ seen: true });

    // Gone on the next open.
    const asked = page.waitForResponse((r) => r.url().endsWith("/api/profile/tips") && r.request().method() === "GET");
    await openTrip(page, tripId);
    await asked;
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Trip settings → Show tips again: back on the next open, not during this one.
    await page.getByRole("button", { name: "Trip settings" }).click();
    const settings = page.getByRole("dialog", { name: "Trip settings" });
    await settings.getByRole("button", { name: "Show tips again" }).click();
    await expect(settings.getByRole("status")).toHaveText("Tips will show the next time you open a trip.");
    await expect.poll(async () => (await ann.context.request.get("/api/profile/tips")).json()).toEqual({ seen: false });
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await expect(settings).toBeHidden();

    await page.goto(`/en/t/${tripId}`);
    await expect(page.getByRole("dialog")).toHaveAccessibleName("These are your days");
  });
});

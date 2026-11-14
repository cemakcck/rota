import type { Page } from "@playwright/test";
import { addPlace, dayPlaces, expect, openTrip, placeInList, startDemo, syncIndicator, test, tripWith } from "./fixtures";

/** Both pages list the same places on Day 1, in the same order, including each of `names`. */
async function converged(a: Page, b: Page, names: string[]) {
  for (const page of [a, b]) for (const name of names) await expect(placeInList(page, name)).toBeVisible();
  await expect.poll(async () => JSON.stringify(await dayPlaces(a, 1))).toBe(JSON.stringify(await dayPlaces(b, 1)));
}

test.describe("offline", () => {
  test("A offline, both edit the same day, A reconnects, both converge (setOffline)", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const bob = await people.signUp("Bob", "#16a34a");
    const tripId = await tripWith(ann, bob);
    await openTrip(ann.page, tripId);
    await openTrip(bob.page, tripId);

    await ann.context.setOffline(true);
    await expect(syncIndicator(ann.page)).toHaveText("Offline — no changes waiting");
    await addPlace(ann.page, "Alfama walk");
    await addPlace(ann.page, "Belém Tower");
    await addPlace(bob.page, "LX Factory");
    await expect(syncIndicator(ann.page)).toHaveText("Offline — 2 changes waiting");
    await expect(placeInList(ann.page, "LX Factory")).toHaveCount(0);
    await expect(placeInList(bob.page, "Alfama walk")).toHaveCount(0);

    await ann.context.setOffline(false);
    await expect(syncIndicator(ann.page)).toHaveText("Synced");
    await converged(ann.page, bob.page, ["Alfama walk", "Belém Tower", "LX Factory"]);
  });

  test("A offline, both edit the same day, A reconnects, both converge (Simulate offline)", async ({ context, page }) => {
    const tripId = await startDemo(context);
    await openTrip(page, tripId);
    const opened = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Try it with a friend" }).click();
    const deniz = await opened;
    await expect(deniz.getByText("You're Deniz in this window")).toBeVisible();
    await expect(syncIndicator(deniz)).toHaveText("Synced");

    const simulate = page.getByRole("switch", { name: "Simulate offline" });
    await simulate.click();
    await expect(syncIndicator(page)).toHaveText("Offline — no changes waiting");
    await addPlace(page, "Pera Museum");
    await addPlace(page, "SALT Galata");
    await addPlace(deniz, "Arter");
    await expect(syncIndicator(page)).toHaveText("Offline — 2 changes waiting");
    await expect(placeInList(page, "Arter")).toHaveCount(0);

    await simulate.click();
    await expect(syncIndicator(page)).toHaveText("Synced");
    await converged(page, deniz, ["Pera Museum", "SALT Galata", "Arter"]);
  });

  test("the trip opens offline after one online visit", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const tripId = await tripWith(ann);
    await openTrip(ann.page, tripId);
    await addPlace(ann.page, "Alfama walk");
    await expect(syncIndicator(ann.page)).toHaveText("Synced");
    // The service worker is in charge of this page (it installs on the first visit).
    await ann.page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => ann.page.evaluate(async () => (await caches.match(location.pathname)) !== undefined)).toBe(true);

    await ann.context.setOffline(true);
    await ann.page.reload();
    await expect(ann.page.getByRole("heading", { name: "Lisbon weekend" })).toBeVisible();
    await expect(placeInList(ann.page, "Alfama walk")).toBeVisible();
    await expect(syncIndicator(ann.page)).toHaveText("Offline — no changes waiting");
  });

  test("first open of an unknown trip while offline says connect once", async ({ people }) => {
    const ann = await people.signUp("Ann");
    await ann.page.goto("/en/trips");
    await ann.page.evaluate(() => navigator.serviceWorker.ready);
    // A trip the device has never seen (its page was never visited here).
    const tripId = await tripWith(ann);
    await ann.context.setOffline(true);
    await ann.page.goto(`/en/t/${tripId}`);
    await expect(ann.page.getByRole("heading", { name: "Connect once to download this trip" })).toBeVisible();
  });
});

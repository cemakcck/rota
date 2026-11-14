import { addPlace, expect, openTrip, placeInList, test, tripWith } from "./fixtures";

test.describe("editing together", () => {
  test("two signed-in members see each other's edits within 2 seconds", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const bob = await people.signUp("Bob", "#16a34a");
    const tripId = await tripWith(ann, bob);
    await openTrip(ann.page, tripId);
    await openTrip(bob.page, tripId);

    await addPlace(ann.page, "Belém Tower");
    await expect(placeInList(bob.page, "Belém Tower")).toBeVisible({ timeout: 2000 });

    await addPlace(bob.page, "Time Out Market");
    await expect(placeInList(ann.page, "Time Out Market")).toBeVisible({ timeout: 2000 });
  });

  test("a remote cursor appears on the map", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const bob = await people.signUp("Bob", "#16a34a");
    const tripId = await tripWith(ann, bob);
    await openTrip(ann.page, tripId);
    await openTrip(bob.page, tripId);

    // Bob points at the middle of his map.
    const map = bob.page.locator("canvas.maplibregl-canvas");
    await expect(map).toBeVisible();
    const box = (await map.boundingBox())!;
    await bob.page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 1 });
    await bob.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });

    const cursor = ann.page.locator(`[data-cursor="${bob.id}"]`);
    await expect(cursor).toBeVisible();
    await expect(cursor).toHaveText("Bob");
  });

  test("undo in A does not revert B's edit", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const bob = await people.signUp("Bob", "#16a34a");
    const tripId = await tripWith(ann, bob);
    await openTrip(ann.page, tripId);
    await openTrip(bob.page, tripId);

    await addPlace(ann.page, "Alfama walk");
    await expect(placeInList(bob.page, "Alfama walk")).toBeVisible();
    await addPlace(bob.page, "LX Factory");
    await expect(placeInList(ann.page, "LX Factory")).toBeVisible();

    await ann.page.getByRole("banner").getByRole("button", { name: "Undo", exact: true }).click();

    for (const page of [ann.page, bob.page]) {
      await expect(placeInList(page, "Alfama walk")).toHaveCount(0);
      await expect(placeInList(page, "LX Factory")).toBeVisible();
    }
  });
});

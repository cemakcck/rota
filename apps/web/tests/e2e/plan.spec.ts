import type { Locator, Page } from "@playwright/test";
import { addPlace, addPlaceAt, dayPlaces, expect, openTrip, test, tripWith } from "./fixtures";

const day = (page: Page, n: number) => page.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) });
const railDay = (page: Page, n: number) => page.getByRole("navigation", { name: "Trip" }).getByRole("button", { name: new RegExp(`^Day ${n} · `) });
const row = (page: Page, name: string) => page.getByRole("main").getByRole("listitem").filter({ has: page.getByTestId("place-name").getByText(name, { exact: true }) });
const toast = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ }).locator("p");

/** Drags with the mouse (dnd-kit starts after 6 px) from the middle of `from` to the middle of `to`. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 2 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

test.describe("planning a day", () => {
  test("add a place with a time, then undo it from the toast", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const { page } = ann;
    await openTrip(page, await tripWith(ann));

    const search = page.getByRole("combobox", { name: "Add a place to Day 1…" });
    await search.fill("Belém Tower");
    await search.press("Enter");
    const step = page.getByRole("form", { name: "Add Belém Tower" });
    // Nothing timed before it: no suggestion, so −30/+30 wait for a time.
    await expect(step.getByLabel("Time")).toBeFocused();
    await expect(step.getByRole("button", { name: "−30 min, earlier" })).toBeDisabled();
    await step.getByLabel("Time").fill("10:00");
    await step.getByRole("button", { name: "+30 min, later" }).click();
    await expect(step.getByLabel("Time")).toHaveValue("10:30");
    await step.getByRole("button", { name: "Add to Day 1", exact: true }).click();

    await expect(step).toBeHidden();
    await expect(row(page, "Belém Tower").getByRole("button", { name: "Change the time for Belém Tower, now 10:30" })).toBeVisible();
    await expect(toast(page)).toHaveText("Added to Day 1 at 10:30");
    // Focus goes to the new stop.
    await expect(page.getByRole("main").getByRole("button", { name: "Belém Tower", exact: true })).toBeFocused();

    await page.getByRole("button", { name: "Undo adding Belém Tower" }).click();
    await expect(row(page, "Belém Tower")).toHaveCount(0);
  });

  test("after a timed stop, the add step suggests a time: kept, cleared or chosen again", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const { page } = ann;
    await openTrip(page, await tripWith(ann));
    // 10:30 plus its hour's stay (an "other" place, no travel known) suggests 11:30 for the next.
    await addPlaceAt(page, "Belém Tower", "10:30");
    const search = page.getByRole("combobox", { name: "Add a place to Day 1…" });
    await search.fill("Time Out Market");
    await search.press("Enter");
    const step = page.getByRole("form", { name: "Add Time Out Market" });
    const time = step.getByLabel("Time");
    const suggested = step.getByRole("button", { name: "Suggested 11:30" });
    await expect(time).toHaveValue("11:30");
    await expect(suggested).toHaveAttribute("aria-pressed", "true");
    await expect(step.getByRole("button", { name: "−30 min, earlier" })).toBeEnabled();

    await step.getByRole("button", { name: "No set time" }).click();
    await expect(time).toHaveValue("");
    await expect(suggested).toHaveAttribute("aria-pressed", "false");
    // −30/+30 still have the suggestion to start from.
    await step.getByRole("button", { name: "+30 min, later" }).click();
    await expect(time).toHaveValue("12:00");
    await suggested.click();
    await expect(time).toHaveValue("11:30");
    await step.getByRole("button", { name: "Add to Day 1", exact: true }).click();

    await expect(page.getByRole("button", { name: "Change the time for Time Out Market, now 11:30" })).toBeVisible();
    await expect.poll(() => dayPlaces(page, 1)).toEqual(["Belém Tower", "Time Out Market"]);
  });

  test("the time is edited in place, and the day re-sorts by time", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const { page } = ann;
    await openTrip(page, await tripWith(ann));
    await addPlaceAt(page, "Belém Tower", "10:00");
    await addPlaceAt(page, "Time Out Market", "12:00");
    await expect.poll(() => dayPlaces(page, 1)).toEqual(["Belém Tower", "Time Out Market"]);

    // Escape leaves it as it was.
    await page.getByRole("button", { name: "Change the time for Time Out Market, now 12:00" }).click();
    const field = page.getByRole("textbox", { name: "Time for Time Out Market" });
    await expect(field).toBeFocused();
    await field.fill("08:00");
    await field.press("Escape");
    await expect(field).toBeHidden();
    const button = page.getByRole("button", { name: "Change the time for Time Out Market, now 12:00" });
    await expect(button).toBeFocused();
    await expect.poll(() => dayPlaces(page, 1)).toEqual(["Belém Tower", "Time Out Market"]);

    await button.click();
    await expect(field).toBeFocused();
    await field.fill("nine");
    await field.press("Enter");
    // Not a time: never dropped silently.
    await expect(page.getByRole("alert").filter({ hasText: "Enter a time like 09:30, or leave it empty." })).toBeVisible();
    await field.fill("09:00");
    await field.press("Enter");

    await expect(page.getByRole("button", { name: "Change the time for Time Out Market, now 09:00" })).toBeVisible();
    await expect.poll(() => dayPlaces(page, 1)).toEqual(["Time Out Market", "Belém Tower"]);
  });

  test("the details panel opens from a stop and closes with Escape", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const { page } = ann;
    await openTrip(page, await tripWith(ann));
    await addPlaceAt(page, "Belém Tower", "10:30");

    const name = page.getByRole("main").getByRole("button", { name: "Belém Tower", exact: true });
    await name.click();
    await expect(name).toHaveAttribute("aria-expanded", "true");
    const details = page.getByRole("region", { name: "Details for Belém Tower" });
    await expect(details.getByLabel("Arrive")).toHaveValue("10:30");
    await expect(details.getByTestId("details-leg")).toHaveText("First stop");
    await expect(details.getByRole("button", { name: "Delete Belém Tower" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
    await expect(name).toBeFocused();
  });

  test("a stop is dragged within its day, then onto another day in the rail", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const { page } = ann;
    await openTrip(page, await tripWith(ann));
    // Day 2 already has a stop, so "at the end" means after it.
    await railDay(page, 2).click();
    await addPlace(page, "Sintra day trip", "Day 2");
    await railDay(page, 1).click();
    for (const name of ["Alfama walk", "Belém Tower", "LX Factory"]) await addPlace(page, name);
    await expect.poll(() => dayPlaces(page, 1)).toEqual(["Alfama walk", "Belém Tower", "LX Factory"]);

    // Onto the first row: it takes that row's place.
    await drag(page, row(page, "LX Factory"), row(page, "Alfama walk"));
    await expect.poll(() => dayPlaces(page, 1)).toEqual(["LX Factory", "Alfama walk", "Belém Tower"]);

    // Onto Day 2 in the rail: at the end of that day.
    await drag(page, row(page, "Alfama walk"), railDay(page, 2));
    await expect.poll(() => dayPlaces(page, 1)).toEqual(["LX Factory", "Belém Tower"]);
    await railDay(page, 2).click();
    await expect.poll(() => dayPlaces(page, 2)).toEqual(["Sintra day trip", "Alfama walk"]);
  });

  test("Shift times moves every set time of the day; the toast undoes it", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const { page } = ann;
    await openTrip(page, await tripWith(ann));
    await addPlaceAt(page, "Belém Tower", "10:00");
    await addPlaceAt(page, "Time Out Market", "12:00");

    await day(page, 1).getByRole("button", { name: "Shift times" }).click();
    await page.getByRole("group", { name: "Shift the times of Day 1" }).getByRole("button", { name: "+30 min, later", exact: true }).click();
    await expect(toast(page)).toHaveText("Shifted 2 stops by +30 min.");
    await expect(page.getByRole("button", { name: "Change the time for Belém Tower, now 10:30" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change the time for Time Out Market, now 12:30" })).toBeVisible();

    await page.getByRole("button", { name: /^Undo shifting the times of Day 1/ }).click();
    await expect(page.getByRole("button", { name: "Change the time for Belém Tower, now 10:00" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change the time for Time Out Market, now 12:00" })).toBeVisible();
  });

  test("deep links open the view they name, and the address follows the view", async ({ people }) => {
    const ann = await people.signUp("Ann");
    const { page } = ann;
    const tripId = await tripWith(ann);
    await openTrip(page, tripId);
    await railDay(page, 2).click();
    await addPlace(page, "LX Factory", "Day 2");
    await expect(page).toHaveURL(/\?view=day&day=[^&]+$/);
    const dayTwo = page.url();

    // A fresh page on the Day 2 link opens on Day 2.
    const other = await ann.context.newPage();
    await other.goto(dayTwo);
    await expect(railDay(other, 2)).toHaveAttribute("aria-current", "true");
    await expect(day(other, 2)).toBeVisible();
    await expect(day(other, 1)).toHaveCount(0);
    await expect.poll(() => dayPlaces(other, 2)).toEqual(["LX Factory"]);

    await other.goto(`/en/t/${tripId}?view=checklist`);
    await expect(other.getByRole("main", { name: "Checklist" })).toBeVisible();
    await other.goto(`/en/t/${tripId}?view=ideas`);
    await expect(other.getByRole("navigation", { name: "Trip" }).getByRole("button", { name: "Ideas & votes" })).toHaveAttribute("aria-current", "true");
    await expect(other.getByRole("region", { name: "Ideas", exact: true })).toContainText("No ideas yet.");
    await expect(other.getByRole("region", { name: "Suggestions" })).toBeVisible();
    await expect(other.getByRole("combobox", { name: "Add a place to Ideas…" })).toBeVisible();
    await expect(day(other, 1)).toHaveCount(0);
    await other.goto(`/en/t/${tripId}?view=all`);
    await expect(day(other, 1)).toBeVisible();
    await expect(day(other, 2)).toBeVisible();
    // A day that does not exist falls back to the first day, and the address says so.
    await other.goto(`/en/t/${tripId}?view=day&day=nope`);
    await expect(railDay(other, 1)).toHaveAttribute("aria-current", "true");
    await expect(other).toHaveURL(/\?view=day&day=(?!nope)[^&]+$/);
    await other.close();
  });
});

import { randomUUID } from "node:crypto";
import { PASSWORD, api, expect, newContext, openTrip, test, tripWith } from "./fixtures";

test.describe("invites", () => {
  test("owner invites by link, a new user signs up through it and lands in the trip", async ({ browser, people }) => {
    const ann = await people.signUp("Ann");
    const tripId = await tripWith(ann);
    await openTrip(ann.page, tripId);
    await ann.page.getByRole("button", { name: "Trip settings" }).click();
    await ann.page.getByRole("button", { name: "Create link" }).click();
    const link = await ann.page.getByRole("textbox", { name: "Join link" }).inputValue();
    expect(link).toMatch(/\/invite\//);
    await ann.page.getByRole("button", { name: "Close", exact: true }).click();

    const context = await newContext(browser);
    try {
      const cem = await context.newPage();
      await cem.goto(link);
      await cem.getByRole("link", { name: "Sign up" }).last().click();
      await cem.getByLabel("Name").fill("Cem");
      await cem.getByLabel("Email").fill(`cem-${randomUUID()}@e2e.rota`);
      await cem.getByLabel("Password").fill(PASSWORD);
      await cem.getByRole("radio", { name: "Teal" }).click();
      await cem.getByRole("button", { name: "Create account" }).click();

      await expect(cem).toHaveURL(new RegExp(`/en/t/${tripId}$`));
      await expect(cem.getByRole("heading", { name: "Lisbon weekend" })).toBeVisible();
      await expect(ann.page.getByRole("list", { name: "In this trip now" }).getByRole("img", { name: "Cem" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('a removed member sees "You were removed from this trip"', async ({ people }) => {
    const ann = await people.signUp("Ann");
    const bob = await people.signUp("Bob", "#16a34a");
    const tripId = await tripWith(ann, bob);
    await openTrip(bob.page, tripId);
    await api(ann, "DELETE", `/api/trips/${tripId}/members/${bob.id}`);
    await expect(bob.page.getByRole("alert").filter({ hasText: "You were removed from this trip." })).toBeVisible();
  });
});

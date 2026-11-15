import { randomUUID } from "node:crypto";
import { PASSWORD, api, expect, hereNow, newContext, openTrip, test, tripWith } from "./fixtures";

test.describe("invites", () => {
  test("owner invites by link, a new user signs up through it and lands in the trip", async ({ browser, people }) => {
    const ann = await people.signUp("Ann");
    const tripId = await tripWith(ann);
    await openTrip(ann.page, tripId);
    // Alone on the trip, the header offers "Invite friends": the people sheet with the invite panel.
    await ann.page.getByRole("banner").getByRole("button", { name: "Invite friends" }).click();
    const sheet = ann.page.getByRole("dialog", { name: "People" });
    await sheet.getByRole("button", { name: "Create link" }).click();
    const link = await sheet.getByRole("textbox", { name: "Join link" }).inputValue();
    expect(link).toMatch(/\/invite\//);
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toBeHidden();

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
      // A new account: the first-time tour opens on the trip; skipping it shows the plan.
      const tour = cem.getByRole("dialog", { name: "These are your days" });
      await tour.getByRole("button", { name: "Skip tour" }).click();
      await expect(tour).toBeHidden();
      await expect(cem.getByRole("heading", { name: "Lisbon weekend" })).toBeVisible();
      await expect(hereNow(ann.page).getByRole("img", { name: "Cem" })).toBeVisible();
      // Ann is no longer alone: the button is "Share", and the sheet lists Cem as a member.
      await ann.page.getByRole("banner").getByRole("button", { name: "Share", exact: true }).click();
      await expect(ann.page.getByRole("dialog", { name: "People" }).getByRole("list", { name: "People on this trip" })).toContainText("Cem");
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

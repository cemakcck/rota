import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, openTrip, startDemo, test } from "./fixtures";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
}

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  test("landing", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("sign-up", async ({ page }) => {
    await page.goto("/en/sign-up");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("My trips", async ({ context, page }) => {
    await startDemo(context);
    await page.goto("/en/trips");
    await expect(page.getByRole("link", { name: /Istanbul long weekend/ })).toBeVisible();
    await expectNoViolations(page);
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`trip screen at ${viewport.width}×${viewport.height}`, async ({ context, page }) => {
      await page.setViewportSize(viewport);
      await openTrip(page, await startDemo(context));
      await expectNoViolations(page);
    });
  }

  test("settings and invite panel", async ({ context, page }) => {
    await openTrip(page, await startDemo(context));
    await page.getByRole("button", { name: "Trip settings" }).click();
    await page.getByRole("button", { name: "Create link" }).click();
    await expect(page.getByRole("textbox", { name: "Join link" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("checklist", async ({ context, page }) => {
    await openTrip(page, await startDemo(context));
    await page.getByRole("tab", { name: /Checklist/ }).click();
    await expect(page.getByRole("list", { name: "Checklist items" })).toBeVisible();
    await expectNoViolations(page);
  });
});

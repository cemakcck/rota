import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, openTrip, startDemo, test } from "./fixtures";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

/** Waits for finite animations (a panel sliding and fading in) to finish: contrast and sizes are read at rest. */
async function settled(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function expectNoViolations(page: Page) {
  await settled(page);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
}

/** The demo trip, editable, opened at `viewport` with its map started (MapLibre adds its own controls as it starts). */
async function openDemo(page: Page, tripId: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await openTrip(page, tripId);
  await expect(page.locator("canvas.maplibregl-canvas")).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: /^Add a place to Day 1/ })).toBeEditable();
}

const firstStop = (page: Page) => page.getByRole("main").getByTestId("place-name").first();
const searchBox = (page: Page) => page.getByRole("combobox", { name: /^Add a place to Day 1/ });

async function openAddStep(page: Page): Promise<Locator> {
  await searchBox(page).fill("Pera Museum");
  await searchBox(page).press("Enter");
  const step = page.getByRole("form", { name: "Add Pera Museum" });
  await expect(step.getByLabel("Time")).toBeFocused();
  return step;
}

/** Opens the first stop's details: a side panel on wide screens, a full-screen dialog on phones. */
async function openDetails(page: Page, phone: boolean): Promise<Locator> {
  const name = (await firstStop(page).textContent())!;
  await firstStop(page).click();
  const details = page.getByRole(phone ? "dialog" : "region", { name: `Details for ${name}` });
  await expect(details.getByRole("button", { name: `Delete ${name}` })).toBeVisible();
  return details;
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

  // The editable trip screen in each of its states, wide and phone.
  for (const viewport of [DESKTOP, PHONE]) {
    const at = `at ${viewport.width}×${viewport.height}`;
    const phone = viewport === PHONE;

    test(`trip screen ${at}`, async ({ context, page }) => {
      await openDemo(page, await startDemo(context), viewport);
      await expectNoViolations(page);
    });

    test(`trip screen, details open, ${at}`, async ({ context, page }) => {
      await openDemo(page, await startDemo(context), viewport);
      await openDetails(page, phone);
      await expectNoViolations(page);
    });

    test(`trip screen, add step open, ${at}`, async ({ context, page }) => {
      await openDemo(page, await startDemo(context), viewport);
      await openAddStep(page);
      await expectNoViolations(page);
    });

    test(`trip screen, tour open, ${at}`, async ({ context, page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/en/t/${await startDemo(context, { tour: true })}`);
      const tour = page.getByRole("dialog", { name: "These are your days" });
      await expect(tour.getByRole("button", { name: "Next" })).toBeVisible();
      await expect(page.locator("canvas.maplibregl-canvas")).toHaveCount(1);
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
    await page.getByRole("navigation", { name: "Trip" }).getByRole("button", { name: /^Checklist/ }).click();
    await expect(page.getByRole("list", { name: "Checklist items" })).toBeVisible();
    await expectNoViolations(page);
  });
});

type Miss = { target: string; size?: string; at?: string; hit?: string };

/**
 * Every visible control in `scope` (itself included) smaller than 44 × 44 px, or not owning its whole box.
 * Once animations have finished, each is scrolled into view, then `elementFromPoint` is asked about
 * points 1 px inside its edges (on the top and bottom edges: in from each corner by its radius, at least
 * 7 px, as hit testing follows rounded corners, and the middle; the middle of the left and right edges)
 * and its centre. A point landing on something else (text painted over it, a neighbour) is a miss.
 */
async function smallTargets(scope: Locator): Promise<Miss[]> {
  // At rest: mid-slide (a transform), boxes measure a hair under their size, 43.999996 px.
  await settled(scope.page());
  return scope.evaluate((root) => {
    const describe = (el: Element) => {
      const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "";
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} "${name}"`;
    };
    const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]';
    const misses: Miss[] = [];
    for (const el of [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)]) {
      if (!(el instanceof HTMLElement)) continue;
      // Out of sight (another tab, the sr-only skip links until focused) is not a target.
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.width < 44 || r.height < 44) {
        misses.push({ target: describe(el), size: `${Math.round(r.width)}×${Math.round(r.height)}` });
        continue;
      }
      // In from the corners by their radius (at least 7 px): hit testing follows rounded corners.
      const radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const inset = Math.min(r.width / 2, Math.max(7, Math.min(radius, r.height / 2)));
      const xs = [r.left + inset, r.left + r.width / 2, r.right - inset];
      const midY = r.top + r.height / 2;
      const points = [...xs.map((x) => [x, r.top + 1]), ...xs.map((x) => [x, r.bottom - 1]), [r.left + 1, midY], [r.right - 1, midY], [r.left + r.width / 2, midY]];
      for (const [x, y] of points) {
        const hit = document.elementFromPoint(x, y);
        if (hit !== null && (hit === el || el.contains(hit))) continue;
        misses.push({ target: describe(el), at: `${Math.round(x - r.left)},${Math.round(y - r.top)}`, hit: hit ? describe(hit) : "nothing" });
        break;
      }
    }
    return misses;
  });
}

test.describe("touch targets at 390×844 (44 × 44 px)", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("header, day chips, plan, tabs and ＋", async ({ context, page }) => {
    await openDemo(page, await startDemo(context), PHONE);
    const scopes = {
      header: page.getByRole("banner"),
      chips: page.getByRole("navigation", { name: "Days" }),
      plan: page.getByRole("main"),
      tabs: page.getByRole("navigation", { name: "Trip views" }),
      fab: page.getByRole("button", { name: "Add place", exact: true }),
    };
    for (const [name, scope] of Object.entries(scopes)) expect(await smallTargets(scope), name).toEqual([]);
  });

  test("the add step and the details sheet", async ({ context, page }) => {
    await openDemo(page, await startDemo(context), PHONE);
    const step = await openAddStep(page);
    expect(await smallTargets(step), "add step").toEqual([]);
    await step.getByRole("button", { name: "Cancel" }).click();
    await expect(step).toBeHidden();

    const details = await openDetails(page, true);
    expect(await smallTargets(details), "details").toEqual([]);
  });
});

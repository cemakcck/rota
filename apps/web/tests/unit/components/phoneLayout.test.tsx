import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addPlace, placeUrl, setPlaceTime, setTripMeta } from "@rota/trip";
import { MapLoaderContext } from "@/components/map/engine";
import { placeFocusId } from "@/components/trip/StopRow";
import { DAY_COLOURS, dayColour } from "@/components/map/mapFeatures";
import { renderIntl, stubFetch } from "./helpers";
import { TIPS_SEEN_U1, fake, newTrip, useFakeTrip } from "./tripHarness";
import { fakeMap } from "../map/fakeMap";

vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/authClient", () => ({
  useUserId: () => fake.userId,
  useUserState: () => ({ userId: fake.userId, signedOut: false }),
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { TripScreen } from "@/components/trip/TripScreen";

const at = (search: string) => window.history.replaceState(null, "", `/en/t/t1${search}`);

// A window whose width can change: `(min-width: …px)` queries answer for it and tell their listeners.
let width = 390;
const listeners = new Set<() => void>();
function stubScreen(px: number) {
  width = px;
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? NaN);
    return {
      get matches() {
        return width >= min;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    };
  });
}
function resize(px: number) {
  act(() => {
    width = px;
    listeners.forEach((l) => l());
  });
}

beforeEach(() => {
  at("");
  listeners.clear();
  stubScreen(390);
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  at("");
});

const chips = () => screen.getByRole("navigation", { name: "Days" });
const chip = (name: string | RegExp) => within(chips()).getByRole("button", { name });
const tabs = () => screen.getByRole("navigation", { name: "Trip views" });
const tab = (name: string) => within(tabs()).getByRole("button", { name });
const current = (el: HTMLElement) => el.getAttribute("aria-current") === "true";
const mapRegion = () => screen.getByRole("region", { name: "Map", hidden: true });
const main = () => document.getElementById("main")!;
const search = () => within(main()).getByRole("combobox");
const pin = (id: string) => document.querySelector<HTMLElement>(`[data-pin="${id}"]`)!;
const names = () => within(main()).queryAllByTestId("place-name").map((e) => e.textContent);

function openTrip() {
  const { doc, dayIds } = newTrip();
  const kahve = addPlace(doc, { name: "Karaköy Güllüoğlu", category: "food", dayId: dayIds[0], lat: 41.0222, lng: 28.9776 }, "u1");
  setPlaceTime(doc, kahve, "09:30", "u1");
  const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], lat: 41.0256, lng: 28.9742, stayMinutes: 60 }, "u1");
  const chora = addPlace(doc, { name: "Chora Church", category: "museum", dayId: dayIds[1], lat: 41.0312, lng: 28.9393 }, "u1");
  const map = fakeMap();
  renderIntl(
    <MapLoaderContext.Provider value={map.load}>
      <TripScreen tripId="t1" />
    </MapLoaderContext.Provider>,
  );
  return { doc, dayIds, kahve, tower, chora, map };
}

describe("phone trip layout", () => {
  it("replaces the rail with day chips and the List/Map toggle with bottom tabs", () => {
    openTrip();
    expect(screen.queryByRole("navigation", { name: "Trip" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resize the list" })).toBeNull();
    // The chosen day's ⋯ menu sits beside its chip.
    expect(within(chips()).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Day 1 · Fri 27", "Day 1 options", "Day 2 · Sat 28", "+ Add a day", "All"]);
    expect(within(tabs()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Plan", "Map", "Ideas", "Checklist"]);
    expect(current(tab("Plan"))).toBe(true);
    // Touch targets are at least 44 × 44 px.
    for (const b of [...within(tabs()).getAllByRole("button"), chip(/^Day 1 · /), chip("All"), screen.getByRole("button", { name: "Add place" })]) {
      expect(b.className).toMatch(/(min-h-11|h-11|h-12|h-14|size-11)/);
    }
  });

  it("chips and tabs drive the same view, and keep the chosen day", () => {
    const { dayIds } = openTrip();
    fireEvent.click(chip(/^Day 2 · /));
    expect(window.location.search).toBe(`?view=day&day=${dayIds[1]}`);
    expect(current(chip(/^Day 2 · /))).toBe(true);
    expect(names()).toEqual(["Chora Church"]);

    fireEvent.click(tab("Ideas"));
    expect(window.location.search).toBe("?view=ideas");
    expect(current(tab("Ideas"))).toBe(true);
    // No chip is what is shown now.
    expect(within(chips()).queryAllByRole("button").some(current)).toBe(false);

    fireEvent.click(tab("Plan"));
    expect(window.location.search).toBe(`?view=day&day=${dayIds[1]}`);
    expect(names()).toEqual(["Chora Church"]);

    fireEvent.click(tab("Checklist"));
    expect(window.location.search).toBe("?view=checklist");
    // The Map tab shows the map for the chosen day; the plan is out of the way.
    fireEvent.click(tab("Map"));
    expect(window.location.search).toBe(`?view=day&day=${dayIds[1]}`);
    expect(current(tab("Map"))).toBe(true);
    expect(main().className).toContain("max-lg:hidden");
    expect(mapRegion().className).not.toContain("max-lg:invisible");

    // A chip on the Map tab changes what the map shows and stays on the map.
    fireEvent.click(chip("All"));
    expect(window.location.search).toBe("?view=all");
    expect(current(tab("Map"))).toBe(true);
    expect(current(chip("All"))).toBe(true);
    fireEvent.click(tab("Plan"));
    expect(window.location.search).toBe("?view=all");
    expect(main().className).not.toContain("max-lg:hidden");
    expect(mapRegion().className).toContain("max-lg:invisible");
  });

  it("a deep link opens on the tab it names", () => {
    at("?view=checklist");
    openTrip();
    expect(current(tab("Checklist"))).toBe(true);
    expect(screen.getByRole("main", { name: "Checklist" })).toBeTruthy();
  });

  it("the floating ＋ focuses the search, from the Map tab too", async () => {
    openTrip();
    fireEvent.click(screen.getByRole("button", { name: "Add place" }));
    expect(document.activeElement).toBe(search());
    fireEvent.click(tab("Map"));
    fireEvent.click(screen.getByRole("button", { name: "Add place" }));
    expect(current(tab("Plan"))).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(search()));
  });

  it("the Map tab's pin card: number, name, arrive · stay · walk, Google Maps and Details", async () => {
    const { tower } = openTrip();
    fireEvent.click(tab("Map"));
    await waitFor(() => expect(pin(tower)).toBeTruthy());
    fireEvent.click(pin(tower));
    // The pin selects its place and shows the card; the details wait for Details.
    expect(screen.queryByRole("dialog")).toBeNull();
    const card = screen.getByRole("region", { name: "Galata Tower" });
    expect(within(card).getByText("2")).toBeTruthy();
    expect(within(card).getByTestId("pin-card-facts").textContent).toMatch(/^Arrive ≈ estimated, \d\d:\d\d · stay 1 h · ≈ estimated, \d+ min walk$/);
    const maps = within(card).getByRole("link", { name: /^Google Maps/ });
    expect(maps.getAttribute("href")).toBe(placeUrl(fake.view.days[0].places[1]));
    expect(maps.getAttribute("target")).toBe("_blank");

    fireEvent.click(within(card).getByRole("button", { name: "Details" }));
    const sheet = screen.getByRole("dialog", { name: "Details for Galata Tower" });
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // Focus goes back to Details (the row is not on screen on the Map tab).
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole("region", { name: "Galata Tower" })).getByRole("button", { name: "Details" })));

    // ✕ puts the card away.
    fireEvent.click(within(screen.getByRole("region", { name: "Galata Tower" })).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Galata Tower" })).toBeNull();
  });

  it("shows the day's weather in its title line", async () => {
    const { doc } = newTrip();
    setTripMeta(doc, { destination: { name: "Istanbul", lat: 41.03, lng: 28.99 } }, "seed");
    const { fn } = stubFetch({
      "GET /api/weather?lat=41.03&lng=28.99&start=2026-11-27&end=2026-11-28": () => ({
        body: { days: [{ date: "2026-11-27", code: 0, max: 17, min: 9, rain: null }], availableFrom: null },
      }),
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);
    const day = screen.getByRole("region", { name: /^Day 1\b/ });
    const chipEl = await within(day).findByRole("img", { name: "Clear, high 17°, low 9°" });
    // On the line of the day's heading, not inside it.
    expect(chipEl.closest("h2")).toBeNull();
    expect(chipEl.parentElement!.querySelector("h2")).toBeTruthy();
  });

  it("the details sheet makes the rest of the screen inert while it is open", () => {
    openTrip();
    fireEvent.click(within(main()).getByRole("button", { name: "Galata Tower" }));
    const sheet = screen.getByRole("dialog", { name: "Details for Galata Tower" });
    expect(sheet.closest("[inert]")).toBeNull();
    for (const el of [screen.getByRole("banner", { hidden: true }), chips(), main(), tabs()]) expect(el.closest("[inert]")).not.toBeNull();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("is not inert on wide screens, where the details are a panel", () => {
    stubScreen(1280);
    openTrip();
    fireEvent.click(within(main()).getByRole("button", { name: "Galata Tower" }));
    expect(screen.getByRole("region", { name: "Details for Galata Tower" })).toBeTruthy();
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("resizing keeps the view, the selection and the open details", async () => {
    const { dayIds, tower } = openTrip();
    fireEvent.click(chip(/^Day 1 · /));
    fireEvent.click(tab("Map"));
    await waitFor(() => expect(pin(tower)).toBeTruthy());
    fireEvent.click(pin(tower));
    // To desktop: the rail, the same day, the place still selected; no card.
    resize(1280);
    const rail = screen.getByRole("navigation", { name: "Trip" });
    expect(current(within(rail).getByRole("button", { name: /^Day 1 · / }))).toBe(true);
    expect(window.location.search).toBe(`?view=day&day=${dayIds[0]}`);
    expect(pin(tower).dataset.selected).toBe("true");
    expect(screen.queryByRole("region", { name: "Galata Tower" })).toBeNull();
    // Back: still on the Map tab with its card.
    resize(390);
    expect(current(tab("Map"))).toBe(true);
    expect(screen.getByRole("region", { name: "Galata Tower" })).toBeTruthy();

    // Details open on desktop become the phone's sheet, and back.
    resize(1280);
    fireEvent.click(pin(tower));
    expect(screen.getByRole("region", { name: "Details for Galata Tower" })).toBeTruthy();
    resize(390);
    expect(screen.getByRole("dialog", { name: "Details for Galata Tower" })).toBeTruthy();
    expect(document.querySelector("[inert]")).not.toBeNull();
    resize(1280);
    expect(screen.getByRole("region", { name: "Details for Galata Tower" })).toBeTruthy();
    // The sheet became the panel: nothing is inert any more.
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("resizing keeps the add step open with what was typed", () => {
    openTrip();
    fireEvent.change(search(), { target: { value: "Ferry pier" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    const step = () => screen.getByRole("form", { name: /^Add Ferry pier/ });
    expect(step()).toBeTruthy();
    resize(1280);
    expect(step()).toBeTruthy();
    resize(390);
    expect(step()).toBeTruthy();
  });

  it("the tour points at the day chips, and stays open across a resize", async () => {
    localStorage.removeItem(TIPS_SEEN_U1);
    const { fn } = stubFetch({ "GET /api/profile/tips": () => ({ body: { seen: false } }), "PUT /api/profile/tips": () => ({ status: 204 }) });
    vi.stubGlobal("fetch", fn);
    newTrip({ tour: true });
    renderIntl(<TripScreen tripId="t1" />);
    await screen.findByRole("dialog", { name: "These are your days" });
    expect(document.querySelectorAll('[data-tour="days"]')).toHaveLength(1);
    expect(document.querySelector('[data-tour="days"]')).toBe(screen.getByRole("navigation", { name: "Days", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    resize(1280);
    expect(screen.getByRole("dialog", { name: "Add a place — pick a time before it goes in" }).textContent).toContain("Step 2 of 3");
    expect(document.querySelector('[data-tour="days"]')).toBe(screen.getByRole("navigation", { name: "Trip", hidden: true }));
  });

  it("focus on a day chip, All, a tab or a pin card button moves to its counterpart across a resize", async () => {
    const { tower } = openTrip();
    const railButton = (name: string | RegExp) => within(screen.getByRole("navigation", { name: "Trip" })).getByRole("button", { name });
    chip(/^Day 2 · /).focus();
    resize(1280);
    expect(document.activeElement).toBe(railButton(/^Day 2 · /));
    resize(390);
    expect(document.activeElement).toBe(chip(/^Day 2 · /));

    chip("All").focus();
    resize(1280);
    expect(document.activeElement).toBe(railButton("Whole trip on map"));
    resize(390);
    expect(document.activeElement).toBe(chip("All"));

    fireEvent.click(tab("Ideas"));
    tab("Ideas").focus();
    resize(1280);
    expect(document.activeElement).toBe(railButton(/^Ideas & votes/));
    resize(390);
    expect(document.activeElement).toBe(tab("Ideas"));

    fireEvent.click(tab("Checklist"));
    tab("Checklist").focus();
    resize(1280);
    expect(document.activeElement).toBe(railButton(/^Checklist/));
    resize(390);
    expect(document.activeElement).toBe(tab("Checklist"));

    // No counterpart (the Plan tab): the plan, never the page.
    fireEvent.click(tab("Plan"));
    tab("Plan").focus();
    resize(1280);
    expect(document.activeElement).toBe(main());

    // A pin card button: the place's row.
    resize(390);
    fireEvent.click(tab("Map"));
    await waitFor(() => expect(pin(tower)).toBeTruthy());
    fireEvent.click(pin(tower));
    within(screen.getByRole("region", { name: "Galata Tower" })).getByRole("button", { name: "Details" }).focus();
    resize(1280);
    expect(document.activeElement).toBe(document.getElementById(placeFocusId(tower)));
  });

  it("the pin card follows the chips: a place no longer on the map has no card, and the ＋ comes back", async () => {
    const { tower } = openTrip();
    fireEvent.click(tab("Map"));
    await waitFor(() => expect(pin(tower)).toBeTruthy());
    fireEvent.click(pin(tower));
    expect(screen.getByRole("region", { name: "Galata Tower" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add place" })).toBeNull();
    fireEvent.click(chip(/^Day 2 · /));
    expect(screen.queryByRole("region", { name: "Galata Tower" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add place" })).toBeTruthy();
    // The whole trip shows it again.
    fireEvent.click(chip("All"));
    expect(screen.getByRole("region", { name: "Galata Tower" })).toBeTruthy();
  });

  it("the toast sits above the tab bar, the ＋ and the pin card, and is held under the details sheet", async () => {
    const { tower } = openTrip();
    // A delete from the details sheet: the sheet closes, the toast shows.
    fireEvent.click(within(main()).getByRole("button", { name: "Karaköy Güllüoğlu" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Karaköy Güllüoğlu" }));
    const toastEl = document.querySelector<HTMLElement>("[data-action-toast]")!;
    expect(toastEl.textContent).toContain("Karaköy Güllüoğlu deleted");
    expect(toastEl.className).toContain("env(safe-area-inset-bottom)");
    // Above the ＋ (16 px over the 56 px tab bar, 48 px tall).
    expect(toastEl.style.getPropertyValue("--toast-lift")).toBe("132px");
    expect(toastEl.closest("[inert]")).toBeNull();

    // Over the details sheet it is held: not operable, not shown.
    fireEvent.click(within(main()).getByRole("button", { name: "Galata Tower" }));
    expect(screen.getByRole("dialog", { name: "Details for Galata Tower" })).toBeTruthy();
    expect(toastEl.closest("[inert]")).not.toBeNull();
    expect(toastEl.className).toContain("invisible");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(toastEl.closest("[inert]")).toBeNull();
    expect(toastEl.className).not.toContain("invisible");

    // Above the pin card on the Map tab.
    fireEvent.click(tab("Map"));
    await waitFor(() => expect(pin(tower)).toBeTruthy());
    fireEvent.click(pin(tower));
    expect(toastEl.style.getPropertyValue("--toast-lift")).toBe("208px");
  });

  it("day header controls, stop rows' controls and the search are 44 px touch targets on phones", () => {
    openTrip();
    const tower = within(main()).getByText("Galata Tower", { selector: "[data-testid=place-name]" }).closest("li")!;
    const targets = [
      within(main()).getByRole("button", { name: "Walk" }),
      within(main()).getByRole("button", { name: "Drive" }),
      within(main()).getByRole("button", { name: /^Shift times/ }),
      within(main()).getByRole("link", { name: /^Open day in Google Maps/ }),
      within(main()).getByRole("textbox", { name: "Title for Day 1" }),
      within(main()).getByRole("button", { name: /^Filter/ }),
      within(tower).getByRole("button", { name: "Galata Tower" }),
      within(tower).getByTestId("place-time"),
      search(),
    ];
    for (const el of targets) expect(el.className).toMatch(/max-lg:(!?h-11|min-h-11|size-11)/);
  });

  it("a delete from the details sheet puts focus on the toast's Undo once the sheet is gone", async () => {
    openTrip();
    fireEvent.click(within(main()).getByRole("button", { name: "Karaköy Güllüoğlu" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Karaköy Güllüoğlu" }));
    const undo = screen.getByRole("button", { name: "Undo deleting Karaköy Güllüoğlu" });
    await waitFor(() => expect(document.activeElement).toBe(undo));
    // Undo puts the place back and focus on its row.
    fireEvent.click(undo);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Karaköy Güllüoğlu"));
  });

  it("the chosen chip is in its day's colour, with white text at AA contrast", () => {
    openTrip();
    const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const luminance = (c: string) => {
      const [r, g, b] = hex(c);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const colour of DAY_COLOURS) expect(1.05 / (luminance(colour) + 0.05)).toBeGreaterThanOrEqual(4.5);
    const toRgb = (c: string) => `rgb(${[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(", ")})`;
    expect(chip(/^Day 1 · /).style.backgroundColor).toBe(toRgb(dayColour(0)));
    expect(chip(/^Day 1 · /).className).toContain("aria-[current=true]:text-white");
    // Not chosen: no fill.
    expect(chip(/^Day 2 · /).style.backgroundColor).toBe("");
  });

  it("a resize after focus left for the page does not pull focus back", () => {
    openTrip();
    chip(/^Day 2 · /).focus();
    chip(/^Day 2 · /).blur();
    expect(document.activeElement).toBe(document.body);
    resize(1280);
    expect(document.activeElement).toBe(document.body);
  });

  it("the pin card keeps one line for the name and one for the facts, whatever their length", async () => {
    const { doc, dayIds } = newTrip();
    const long = "The Very Long Named Rooftop Restaurant With A View Over The Golden Horn And Beyond";
    const id = addPlace(doc, { name: long, category: "food", dayId: dayIds[0], lat: 41.0256, lng: 28.9742 }, "u1");
    const map = fakeMap();
    renderIntl(
      <MapLoaderContext.Provider value={map.load}>
        <TripScreen tripId="t1" />
      </MapLoaderContext.Provider>,
    );
    fireEvent.click(tab("Map"));
    await waitFor(() => expect(pin(id)).toBeTruthy());
    fireEvent.click(pin(id));
    // The full name is still the card's name, shown on one clipped line.
    const card = screen.getByRole("region", { name: long });
    expect(within(card).getByRole("heading", { name: long }).className).toContain("truncate");
    expect(within(card).getByTestId("pin-card-facts").className).toContain("truncate");
  });
});

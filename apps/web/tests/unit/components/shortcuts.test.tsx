import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addPlace } from "@rota/trip";
import { MapLoaderContext } from "@/components/map/engine";
import { CHARACTER_KEYS_STORAGE } from "@/components/trip/ShortcutsDialog";
import { fakeMap } from "../map/fakeMap";
import { renderIntl } from "./helpers";
import { fake, newTrip, useFakeTrip } from "./tripHarness";

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
/** Screens of the given width for `(min-width: …px)` queries. */
function screenWidth(px: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? NaN);
    return { matches: px >= min, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
}
const nextFrame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));

beforeEach(() => {
  at("");
  localStorage.removeItem(CHARACTER_KEYS_STORAGE);
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem(CHARACTER_KEYS_STORAGE);
  at("");
});

const main = () => document.getElementById("main")!;
const search = () => within(main()).getByRole("combobox");
const sheet = () => screen.queryByRole("dialog", { name: "Keyboard shortcuts" });
const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.activeElement ?? document.body) => fireEvent.keyDown(target, { key, ...init });
const dayHeading = () => within(main()).getByRole("heading", { level: 2 }).textContent;

function openTrip(days = 3) {
  const { doc, dayIds } = newTrip({ days });
  const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], lat: 41.0256, lng: 28.9742 }, "u1");
  addPlace(doc, { name: "Chora Church", category: "museum", dayId: dayIds[1], lat: 41.0312, lng: 28.9393 }, "u1");
  const map = fakeMap();
  renderIntl(
    <MapLoaderContext.Provider value={map.load}>
      <TripScreen tripId="t1" />
    </MapLoaderContext.Provider>,
  );
  return { doc, dayIds, tower };
}

describe("keyboard shortcuts", () => {
  it("? opens the shortcuts sheet listing every shortcut; Escape closes it and focus goes back", async () => {
    openTrip();
    const before = screen.getByRole("button", { name: "Galata Tower" });
    before.focus();
    press("?", { shiftKey: true });
    const dialog = sheet()!;
    expect(dialog).toBeTruthy();
    const text = dialog.textContent!;
    for (const said of ["Show keyboard shortcuts", "Search for a place to add", "Previous day", "Next day", "Move the stop up or down", "Undo", "Redo", "Close the details panel"]) {
      expect(text).toContain(said);
    }
    for (const key of ["?", "/", "[", "]", "Alt", "↑", "↓", "Z", "Shift", "Esc"]) {
      expect(within(dialog).getAllByText(key, { selector: "kbd" }).length).toBeGreaterThan(0);
    }
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(sheet()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(before));
  });

  it("/ focuses the search without typing a slash", () => {
    openTrip();
    expect(press("/")).toBe(false); // default prevented
    expect(document.activeElement).toBe(search());
    expect((search() as HTMLInputElement).value).toBe("");
  });

  it("] and [ go to the next and previous day, in the address too, and stop at the ends", async () => {
    const { dayIds } = openTrip(3);
    expect(dayHeading()).toMatch(/^Day 1\b/);
    press("]");
    expect(window.location.search).toBe(`?view=day&day=${dayIds[1]}`);
    expect(dayHeading()).toMatch(/^Day 2\b/);
    // Screen readers hear where they are now.
    expect(screen.getByTestId("shortcut-status").textContent).toMatch(/^Day 2\b/);
    press("]");
    press("]");
    expect(window.location.search).toBe(`?view=day&day=${dayIds[2]}`);
    press("[");
    press("[");
    press("[");
    expect(window.location.search).toBe(`?view=day&day=${dayIds[0]}`);
  });

  it("from Ideas or the whole trip, ] goes to the first day and [ to the last", () => {
    const { dayIds } = openTrip(3);
    at("?view=ideas");
    act(() => void window.dispatchEvent(new PopStateEvent("popstate")));
    press("]");
    expect(window.location.search).toBe(`?view=day&day=${dayIds[0]}`);
    at("?view=all");
    act(() => void window.dispatchEvent(new PopStateEvent("popstate")));
    press("[");
    expect(window.location.search).toBe(`?view=day&day=${dayIds[2]}`);
  });

  it("focus on a row of the day left behind goes to the plan, not the page", async () => {
    openTrip();
    screen.getByRole("button", { name: "Galata Tower" }).focus();
    press("]");
    await nextFrame();
    expect(document.activeElement).toBe(main());
  });

  it("Escape closes the details panel when focus is outside it", async () => {
    openTrip();
    const row = screen.getByRole("button", { name: "Galata Tower" });
    fireEvent.click(row);
    expect(screen.getByRole("region", { name: "Details for Galata Tower" })).toBeTruthy();
    // Focus back in the list (the panel is non-modal on wide screens).
    row.focus();
    press("Escape");
    expect(screen.queryByRole("region", { name: "Details for Galata Tower" })).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("none fire while typing in a field or while a dialog is open", async () => {
    const { dayIds } = openTrip();
    // Typing in the search: the keys are text.
    search().focus();
    for (const key of ["?", "[", "]", "/"]) expect(press(key, {}, search())).toBe(true);
    expect(sheet()).toBeNull();
    expect(window.location.search).toBe("");
    // The day's title field, too.
    const title = screen.getByRole("textbox", { name: "Title for Day 1" });
    title.focus();
    press("]", {}, title);
    expect(window.location.search).toBe("");

    // A dialog is open (Move to…): no shortcut reaches the trip behind it.
    fireEvent.click(screen.getByRole("button", { name: "Galata Tower" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Details for Galata Tower" })).getByRole("button", { name: /^Move Galata Tower to/ }));
    const move = screen.getByRole("dialog", { name: /Galata Tower/ });
    press("]", {}, move);
    press("?", {}, move);
    expect(window.location.search).not.toBe(`?view=day&day=${dayIds[1]}`);
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    // Escape there closes the dialog only, not the details behind it.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Galata Tower/ })).toBeNull());
    expect(screen.getByRole("region", { name: "Details for Galata Tower" })).toBeTruthy();
  });

  it("ignores Ctrl/Cmd chords, so the browser's own keys keep working", () => {
    openTrip();
    expect(press("]", { ctrlKey: true })).toBe(true);
    expect(press("/", { metaKey: true })).toBe(true);
    expect(window.location.search).toBe("");
    expect(sheet()).toBeNull();
  });

  it("single-key shortcuts can be turned off in the sheet (WCAG 2.1.4); the choice is remembered", async () => {
    openTrip();
    press("?");
    const toggle = within(sheet()!).getByRole("switch", { name: "Single-key shortcuts" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem(CHARACTER_KEYS_STORAGE)).toBe("off");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(sheet()).toBeNull());
    press("]");
    press("/");
    press("?");
    expect(window.location.search).toBe("");
    expect(document.activeElement).not.toBe(search());
    expect(sheet()).toBeNull();
    // The sheet still opens from its button (in the skip links), and Escape still closes panels.
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(sheet()).toBeTruthy();
  });
});

describe("keyboard shortcuts: review fixes", () => {
  it("say the day again when [ or ] lands on the same day as before", () => {
    openTrip(3);
    at("?view=ideas");
    act(() => void window.dispatchEvent(new PopStateEvent("popstate")));
    press("]");
    const first = screen.getByTestId("shortcut-status").textContent;
    expect(first).toMatch(/^Day 1\b/);
    at("?view=ideas");
    act(() => void window.dispatchEvent(new PopStateEvent("popstate")));
    press("]");
    const second = screen.getByTestId("shortcut-status").textContent;
    // The live region changes, so it is announced again.
    expect(second).not.toBe(first);
    expect(second!.trim()).toBe(first!.trim());
  });

  it("work from a checkbox or a button (they take no text)", () => {
    const { dayIds } = openTrip();
    const box = document.createElement("input");
    box.type = "checkbox";
    main().append(box);
    box.focus();
    press("]", {}, box);
    expect(window.location.search).toBe(`?view=day&day=${dayIds[1]}`);
    box.remove();
  });

  it("do nothing while an input method is composing, or in a contenteditable", () => {
    openTrip();
    expect(press("]", { isComposing: true }, document.body)).toBe(true);
    expect(window.location.search).toBe("");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("p");
    editable.append(inner);
    main().append(editable);
    expect(press("]", {}, inner)).toBe(true);
    expect(press("?", {}, inner)).toBe(true);
    expect(window.location.search).toBe("");
    expect(sheet()).toBeNull();
    editable.remove();
  });

  it("the off switch works for the session when storage is blocked", async () => {
    openTrip();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      press("?");
      const toggle = within(sheet()!).getByRole("switch", { name: "Single-key shortcuts" });
      // (The session's choice may be left over from an earlier test: start from on.)
      if (toggle.getAttribute("aria-checked") === "false") fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      await waitFor(() => expect(sheet()).toBeNull());
      press("]");
      expect(window.location.search).toBe("");
      // Back on, for the next tests (memory only).
      fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
      fireEvent.click(within(sheet()!).getByRole("switch", { name: "Single-key shortcuts" }));
    } finally {
      get.mockRestore();
      set.mockRestore();
      remove.mockRestore();
    }
  });

  it("the sheet shows Alt with both arrows for reordering", () => {
    openTrip();
    press("?");
    const row = within(sheet()!).getByText("Move the stop up or down (on its name)").closest("div")!;
    expect(within(row).getAllByText("Alt", { selector: "kbd" })).toHaveLength(2);
    expect(row.textContent).toContain("Alt plus up arrow or Alt plus down arrow");
  });
});

describe("skip link", () => {
  it("is the first thing to tab to, and takes focus to the plan", () => {
    openTrip();
    const focusable = document.querySelectorAll<HTMLElement>("a[href], button, input, [tabindex='0']");
    const skip = screen.getByRole("link", { name: "Skip to plan" });
    expect(focusable[0]).toBe(skip);
    expect(skip.getAttribute("href")).toBe("#main");
    fireEvent.click(skip);
    expect(document.activeElement).toBe(main());
  });

  it("on the phone's Map tab it goes back to the plan first", async () => {
    screenWidth(390);
    openTrip();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Trip views" })).getByRole("button", { name: "Map" }));
    expect(main().className).toContain("max-lg:hidden");
    fireEvent.click(screen.getByRole("link", { name: "Skip to plan" }));
    await nextFrame();
    expect(main().className).not.toContain("max-lg:hidden");
    expect(document.activeElement).toBe(main());
  });

  it("/ on the phone's Map tab goes to the Plan tab's search", async () => {
    screenWidth(390);
    openTrip();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Trip views" })).getByRole("button", { name: "Map" }));
    press("/");
    await nextFrame();
    expect(main().className).not.toContain("max-lg:hidden");
    expect(document.activeElement).toBe(search());
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as Y from "yjs";
import { addPlace, dayNote, deletePlace, readTrip, setDay } from "@rota/trip";
import { MapLoaderContext } from "@/components/map/engine";
import { fakeMap } from "../map/fakeMap";
import { renderIntl } from "./helpers";
import { fake, newTrip, remoteEdit, useFakeTrip } from "./tripHarness";

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
beforeEach(() => at(""));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  at("");
});

const rail = () => screen.getByRole("navigation", { name: "Trip" });
const railDays = () => within(rail()).getAllByRole("button", { name: /^Day \d · / });
const day = (n: number) => screen.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) });
const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
const times = () => readTrip(fake.doc).days[0].places.map((p) => `${p.name}:${p.time ?? "-"}`);

function writeNote(doc: Y.Doc, dayId: string, lines: string[]) {
  doc.transact(() => {
    dayNote(doc, dayId).insert(
      0,
      lines.map((line) => {
        const p = new Y.XmlElement("paragraph");
        p.insert(0, [new Y.XmlText(line)]);
        return p;
      }),
    );
  }, "u1");
}

async function withMap() {
  const map = fakeMap();
  renderIntl(
    <MapLoaderContext.Provider value={map.load}>
      <TripScreen tripId="t1" />
    </MapLoaderContext.Provider>,
  );
  await waitFor(() => expect(document.querySelectorAll("[data-pin]").length).toBeGreaterThan(0));
  return map;
}

describe("day titles", () => {
  it("each day's title is edited in its header and named on the rail, which falls back to its stop count", () => {
    const { doc, dayIds } = newTrip({ days: 2 });
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Balat", category: "sight", dayId: dayIds[1] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    expect(railDays().map((d) => d.textContent)).toEqual(["Day 1 · Fri 271 stop", "Day 2 · Sat 281 stop"]);

    const title = within(day(1)).getByRole("textbox", { name: "Title for Day 1" }) as HTMLInputElement;
    expect(title.placeholder).toBe("Add a title");
    expect(title.maxLength).toBe(40);
    fireEvent.change(title, { target: { value: "Karaköy & Galata" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(readTrip(doc).days[0].title).toBe("Karaköy & Galata");
    expect(railDays().map((d) => d.textContent)).toEqual(["Day 1 · Fri 27Karaköy & Galata", "Day 2 · Sat 281 stop"]);
    // A friend's title arrives too.
    remoteEdit("u2", (d, origin) => setDay(d, dayIds[1], { title: "Balat" }, origin));
    expect(railDays()[1].textContent).toBe("Day 2 · Sat 28Balat");
  });

  it("read-only, the title shows as text, without a field", () => {
    const { doc, dayIds } = newTrip({ days: 1 });
    setDay(doc, dayIds[0], { title: "Old city" }, "u1");
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(day(1)).queryByRole("textbox", { name: "Title for Day 1" })).toBeNull();
    expect(within(day(1)).getByText("Old city")).toBeTruthy();
  });
});

describe("day note", () => {
  it("sits at the top of the day, under its header, above the search and the stops, and opens in place", () => {
    const { doc, dayIds } = newTrip({ days: 1 });
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    writeNote(doc, dayIds[0], ["Karaköy and Galata on foot."]);
    renderIntl(<TripScreen tripId="t1" />);
    const note = within(day(1)).getByText("Karaköy and Galata on foot.");
    const search = within(day(1)).getByRole("combobox", { name: /^Add a place to/ });
    const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(note, search)).toBe(true);
    expect(follows(note, row("Galata Tower"))).toBe(true);
    expect(follows(within(day(1)).getByRole("textbox", { name: "Title for Day 1" }), note)).toBe(true);
    fireEvent.click(within(day(1)).getByRole("button", { name: "Edit note for Day 1" }));
    expect(within(day(1)).getByRole("textbox", { name: "Note for Day 1" })).toBeTruthy();
  });

  it("is collapsed to two lines, with more / less when it is longer", () => {
    const { doc, dayIds } = newTrip({ days: 1 });
    writeNote(doc, dayIds[0], ["One", "Two", "Three", "Four"]);
    // jsdom has no layout: the clamped preview reports itself taller than it shows.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.noteText !== undefined ? 80 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.noteText !== undefined ? (this.className.includes("line-clamp-2") ? 40 : 80) : 0;
    });
    renderIntl(<TripScreen tripId="t1" />);
    const preview = within(day(1)).getByText(/One/);
    expect(preview.className).toContain("line-clamp-2");
    const more = within(day(1)).getByRole("button", { name: "Show more of the note for Day 1" });
    expect(more.textContent).toBe("more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(preview.className).not.toContain("line-clamp-2");
    const less = within(day(1)).getByRole("button", { name: "Show less of the note for Day 1" });
    expect(less.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(less);
    expect(preview.className).toContain("line-clamp-2");
  });

  it("a short note has no more control", () => {
    const { doc, dayIds } = newTrip({ days: 1 });
    writeNote(doc, dayIds[0], ["Short."]);
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(day(1)).queryByRole("button", { name: /Show more of the note/ })).toBeNull();
  });
});

describe("shift times", () => {
  function plan() {
    const { doc, dayIds } = newTrip({ days: 1 });
    addPlace(doc, { name: "Breakfast", category: "food", dayId: dayIds[0], time: "08:30" }, "u1");
    addPlace(doc, { name: "Walk", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Dinner", category: "food", dayId: dayIds[0], time: "23:45" }, "u1");
    return { doc, dayIds };
  }
  const openShift = () => {
    const button = within(day(1)).getByRole("button", { name: "Shift times" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    return within(day(1)).getByRole("group", { name: "Shift the times of Day 1" });
  };

  it("offers −60/−30/−15/+15/+30/+60 min", () => {
    plan();
    renderIntl(<TripScreen tripId="t1" />);
    const menu = openShift();
    const buttons = within(menu).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["−60 min", "−30 min", "−15 min", "+15 min", "+30 min", "+60 min"]);
    // Label in name (WCAG 2.5.3): each name starts with what is shown, then says which way. An aria-label,
    // as an sr-only span (positioned) reads as a block in Chrome and leaves a space: "+30 min , later".
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "−60 min, earlier",
      "−30 min, earlier",
      "−15 min, earlier",
      "+15 min, later",
      "+30 min, later",
      "+60 min, later",
    ]);
    for (const b of buttons) {
      expect(b.querySelector(".sr-only")).toBeNull();
      expect(b.getAttribute("aria-label")!.startsWith(b.textContent!)).toBe(true);
    }
    expect(within(menu).getByRole("button", { name: "−30 min, earlier" })).toBe(buttons[1]);
    // Fits the 400 px list column: anchored to the left of the day's action row (not to the button, which
    // may sit at its right end), at most the row's width, the six steps on two rows of three.
    expect(menu.className).toMatch(/\babsolute\b/);
    expect(menu.className).toMatch(/\bleft-0\b/);
    expect(menu.className).toMatch(/\bmax-w-full\b/);
    expect(menu.className).toMatch(/\bgrid-cols-3\b/);
    expect(menu.className).not.toMatch(/\bw-max\b/);
    const anchor = menu.parentElement!.closest(".relative");
    expect(anchor?.hasAttribute("data-day-actions")).toBe(true);
    // Escape closes it, focus back on its button.
    fireEvent.keyDown(within(menu).getAllByRole("button")[0], { key: "Escape" });
    expect(within(day(1)).queryByRole("group", { name: "Shift the times of Day 1" })).toBeNull();
    expect(document.activeElement).toBe(within(day(1)).getByRole("button", { name: "Shift times" }));
  });

  it("moves every set time, says how many and which were kept at 23:59, and Undo reverts it in one step", () => {
    plan();
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(openShift()).getByRole("button", { name: "+30 min, later" }));
    expect(times()).toEqual(["Breakfast:09:00", "Walk:-", "Dinner:23:59"]);
    expect(screen.getByText("Shifted 2 stops by +30 min. 1 stop kept at 23:59.")).toBeTruthy();
    expect(within(day(1)).queryByRole("group", { name: "Shift the times of Day 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo shifting the times of Day 1" }));
    expect(times()).toEqual(["Breakfast:08:30", "Walk:-", "Dinner:23:45"]);
  });

  it("earlier, without clamping, the toast has no clamped note", () => {
    plan();
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(openShift()).getByRole("button", { name: "−15 min, earlier" }));
    expect(times()).toEqual(["Breakfast:08:15", "Walk:-", "Dinner:23:30"]);
    expect(screen.getByText("Shifted 2 stops by −15 min.")).toBeTruthy();
  });

  it("when every set time is already at the limit, nothing moves and the toast offers no Undo", () => {
    const { doc, dayIds } = newTrip({ days: 1 });
    addPlace(doc, { name: "Late", category: "food", dayId: dayIds[0], time: "23:59" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(openShift()).getByRole("button", { name: "+15 min, later" }));
    expect(times()).toEqual(["Late:23:59"]);
    expect(screen.getByText("No times changed: they are already at 23:59.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Undo shifting/ })).toBeNull();
  });

  it("is unavailable for a day without set times, and read-only", () => {
    const { doc, dayIds } = newTrip({ days: 1 });
    addPlace(doc, { name: "Walk", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    // Still focusable, so its reason can be heard: aria-disabled, described by why.
    const shift = within(day(1)).getByRole("button", { name: "Shift times" }) as HTMLButtonElement;
    expect(shift.disabled).toBe(false);
    expect(shift.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(shift.getAttribute("aria-describedby")!)!.textContent).toBe("No set times to shift");
    fireEvent.click(shift);
    expect(shift.getAttribute("aria-expanded")).toBe("false");
    expect(within(day(1)).queryByRole("group", { name: "Shift the times of Day 1" })).toBeNull();
    cleanup();
    plan();
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(day(1)).queryByRole("button", { name: "Shift times" })).toBeNull();
  });
});

describe("linked rows and pins", () => {
  function pinned() {
    const { doc, dayIds } = newTrip({ days: 1 });
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], lat: 41.0256, lng: 28.9742 }, "u1");
    const lokanta = addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[0], lat: 41.0228, lng: 28.9779 }, "u1");
    return { tower, lokanta };
  }
  const pin = (id: string) => document.querySelector<HTMLElement>(`[data-pin="${id}"]`)!;

  it("hovering a row highlights its pin, and hovering a pin its row", async () => {
    const { tower, lokanta } = pinned();
    await withMap();
    fireEvent.pointerEnter(row("Galata Tower"), { pointerType: "mouse" });
    expect(pin(tower).dataset.hovered).toBe("true");
    expect(pin(lokanta).dataset.hovered).toBeUndefined();
    fireEvent.pointerLeave(row("Galata Tower"), { pointerType: "mouse" });
    expect(pin(tower).dataset.hovered).toBeUndefined();

    fireEvent.pointerEnter(pin(lokanta), { pointerType: "mouse" });
    expect(row("Karaköy Lokantası").dataset.hovered).toBe("true");
    expect(row("Galata Tower").dataset.hovered).toBeUndefined();
    fireEvent.pointerLeave(pin(lokanta), { pointerType: "mouse" });
    expect(row("Karaköy Lokantası").dataset.hovered).toBeUndefined();
  });

  it("a hovered place that leaves the view is no longer hovered when it comes back", async () => {
    const { tower } = pinned();
    await withMap();
    fireEvent.pointerEnter(row("Galata Tower"), { pointerType: "mouse" });
    expect(pin(tower).dataset.hovered).toBe("true");
    // Deleted under the pointer (no pointerleave), then brought back with Ctrl+Z.
    act(() => deletePlace(fake.doc, tower, "u1"));
    expect(screen.queryByText("Galata Tower", { selector: "[data-testid=place-name]" })).toBeNull();
    act(() => void fireEvent.keyDown(window, { key: "z", ctrlKey: true }));
    expect(row("Galata Tower").dataset.hovered).toBeUndefined();
    expect(pin(tower).dataset.hovered).toBeUndefined();

    // Another day chosen from the keyboard while hovering: back on this day, nothing is hovered.
    fireEvent.pointerEnter(row("Galata Tower"), { pointerType: "mouse" });
    fireEvent.click(within(rail()).getByRole("button", { name: "Ideas & votes, 0" }));
    fireEvent.click(railDays()[0]);
    expect(row("Galata Tower").dataset.hovered).toBeUndefined();
  });

  it("a click on the empty map closes the details panel", async () => {
    const { tower } = pinned();
    const map = await withMap();
    fireEvent.click(pin(tower));
    expect(screen.getByRole("region", { name: "Details for Galata Tower" })).toBeTruthy();
    const surface = map.state.container!;
    fireEvent.pointerDown(surface, { clientX: 5, clientY: 5, pointerType: "mouse" });
    act(() => void fireEvent.click(surface, { clientX: 5, clientY: 5 }));
    expect(screen.queryByRole("region", { name: "Details for Galata Tower" })).toBeNull();
    // The place stays selected.
    expect(row("Galata Tower").getAttribute("aria-current")).toBe("true");
  });
});

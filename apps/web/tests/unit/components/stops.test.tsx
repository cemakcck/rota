import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { addPlace, createUndo, deletePlace, movePlace, placeUrl, setPlaceTime, updatePlace } from "@rota/trip";
import { renderIntl } from "./helpers";
import { fake, newTrip, remoteEdit, remotePeer, useFakeTrip } from "./tripHarness";

vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/authClient", () => ({
  useUserId: () => fake.userId,
  useUserState: () => ({ userId: fake.userId, signedOut: false }),
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { TripScreen } from "@/components/trip/TripScreen";

// The whole trip in the list column: these cover every day and Ideas at once.
beforeEach(() => window.history.replaceState(null, "", "/en/t/t1?view=all"));
import { dropPlace, dropTarget, listDropId, placeDropId } from "@/components/trip/plan";

afterEach(cleanup);

const day = (n: number) => screen.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) });
const names = (region: HTMLElement) => within(region).queryAllByTestId("place-name").map((e) => e.textContent);
const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
/** Opens a stop (click on its name): its details panel. */
const open = (name: string) => fireEvent.click(within(row(name)).getByRole("button", { name }));

describe("stops", () => {
  it("adds, edits category and tags, deletes a place, and Undo restores it", () => {
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);

    const search = screen.getByRole("combobox", { name: "Add a place to Day 1…" });
    fireEvent.change(search, { target: { value: "  Galata Tower " } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Add to Day 1" }));
    expect(names(day(1))).toEqual(["Galata Tower"]);

    open("Galata Tower");
    expect(within(row("Galata Tower")).getByRole("button", { name: "Galata Tower" }).getAttribute("aria-expanded")).toBe("true");
    const details = screen.getByRole("region", { name: "Details for Galata Tower" });
    fireEvent.click(within(details).getByRole("button", { name: /^Change category/ }));
    fireEvent.click(within(details).getByRole("radio", { name: "Museum" }));
    const tags = within(details).getByLabelText("Tags");
    fireEvent.change(tags, { target: { value: "views" } });
    fireEvent.keyDown(tags, { key: "Enter" });
    fireEvent.change(tags, { target: { value: "sunset, Views" } });
    fireEvent.change(within(details).getByLabelText("Stay"), { target: { value: "90" } });

    expect(fake.view.days[0].places[0]).toMatchObject({ name: "Galata Tower", category: "museum", tags: ["views", "sunset"], stayMinutes: 90 });
    expect(within(row("Galata Tower")).getByRole("img", { name: "Museum" })).toBeTruthy();
    expect(within(row("Galata Tower")).getByText("Museum · views, sunset")).toBeTruthy();
    expect(within(row("Galata Tower")).getByText("1 h 30 min")).toBeTruthy();

    // Still open: Delete is in the details.
    fireEvent.click(screen.getByRole("button", { name: "Delete Galata Tower" }));
    expect(names(day(1))).toEqual([]);
    expect(screen.getByText("Galata Tower deleted.")).toBeTruthy();
    const undo = screen.getByRole("button", { name: "Undo deleting Galata Tower" });
    expect(document.activeElement).toBe(undo);
    fireEvent.click(undo);
    expect(names(day(1))).toEqual(["Galata Tower"]);
    expect(fake.view.days[0].places[0]).toMatchObject({ category: "museum", tags: ["views", "sunset"] });
    expect(screen.queryByText("Galata Tower deleted.")).toBeNull();
  });

  it("keyboard move via Move to…", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    open("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Move Galata Tower to…" }));
    const dialog = screen.getByRole("dialog", { name: "Move Galata Tower" });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Day 2/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(names(day(1))).toEqual(["Karaköy Lokantası"]);
    expect(names(day(2))).toEqual(["Galata Tower"]);

    fireEvent.click(screen.getByRole("button", { name: "Move Galata Tower to…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Ideas" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move" }));
    expect(names(screen.getByRole("region", { name: "Ideas" }))).toEqual(["Galata Tower"]);
  });

  it("a timed stop moved to another day keeps its time and goes to its place by time there, as one undo step, said politely", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], time: "15:00" }, "u1");
    addPlace(doc, { name: "Breakfast", category: "food", stayMinutes: 45, dayId: dayIds[1], time: "08:00" }, "u1");
    addPlace(doc, { name: "Dinner", category: "food", dayId: dayIds[1], time: "19:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    open("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Move Galata Tower to…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /^Day 2/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move" }));
    expect(fake.view.days[1].places.map((p) => [p.name, p.time])).toEqual([
      ["Breakfast", "08:00"],
      ["Galata Tower", "15:00"],
      ["Dinner", "19:00"],
    ]);
    expect(screen.getByTestId("plan-status").textContent).toBe("Galata Tower moved to Day 2 at 15:00, position 2 of 3");
    // One undo step: back in Day 1, still at 15:00.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(fake.view.days[0].places.map((p) => [p.name, p.time])).toEqual([["Galata Tower", "15:00"]]);
    expect(names(day(2))).toEqual(["Breakfast", "Dinner"]);
  });

  it("an untimed stop moved to another day stays untimed, at the end", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Breakfast", category: "food", dayId: dayIds[1], time: "08:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    open("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Move Galata Tower to…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /^Day 2/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move" }));
    expect(fake.view.days[1].places.map((p) => [p.name, p.time])).toEqual([
      ["Breakfast", "08:00"],
      ["Galata Tower", null],
    ]);
    expect(screen.getByTestId("plan-status").textContent).toBe("Galata Tower moved to Day 2, position 2 of 2");
  });

  it("a timed stop dropped on a day in the rail keeps its time; dragged within a day it is re-timed", () => {
    const { doc, dayIds } = newTrip();
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], time: "15:00" }, "u1");
    addPlace(doc, { name: "Breakfast", category: "food", stayMinutes: 45, dayId: dayIds[1], time: "08:00" }, "u1");
    const dinner = addPlace(doc, { name: "Dinner", category: "food", dayId: dayIds[1], time: "19:00" }, "u1");
    expect(dropPlace(doc, fake.view, tower, `rail:day:${dayIds[1]}`, "u1")).toBe(true);
    expect(fake.view.days[1].places.map((p) => [p.name, p.time])).toEqual([
      ["Breakfast", "08:00"],
      ["Galata Tower", "15:00"],
      ["Dinner", "19:00"],
    ]);
    // Within a day (onto a row): re-timed for the slot.
    expect(dropPlace(doc, fake.view, dinner, placeDropId(tower), "u1")).toBe(true);
    expect(fake.view.days[1].places.map((p) => [p.name, p.time])).toEqual([
      ["Breakfast", "08:00"],
      ["Dinner", "08:45"],
      ["Galata Tower", "15:00"],
    ]);
    // Dropped on another day's list: kept too.
    expect(dropPlace(doc, fake.view, tower, listDropId(dayIds[0]), "u1")).toBe(true);
    expect(fake.view.days[0].places.map((p) => [p.name, p.time])).toEqual([["Galata Tower", "15:00"]]);
  });

  it("remote delete while the Move dialog is open closes it", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    open("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Move Galata Tower to…" }));
    expect(screen.getByRole("dialog", { name: "Move Galata Tower" })).toBeTruthy();
    remoteEdit("u2", (d, origin) => deletePlace(d, id, origin));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(names(day(1))).toEqual([]);
  });

  it("remote move is announced once with the member's name", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Pera Museum", category: "museum", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const live = screen.getByTestId("announcer");
    expect(live.getAttribute("aria-live")).toBe("polite");

    remoteEdit("u2", (d, origin) => movePlace(d, id, { dayId: dayIds[1] }, origin));
    expect(names(day(2))).toEqual(["Galata Tower"]);
    expect(live.textContent).toBe("Deniz moved Galata Tower to Day 2");
    expect(screen.getAllByText("Deniz moved Galata Tower to Day 2")).toHaveLength(1);

    // A remote edit that is not structural, and my own moves, are not announced.
    remoteEdit("u2", (d, origin) => updatePlace(d, id, { tags: ["views"] }, origin));
    open("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Move Galata Tower to…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Ideas" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move" }));
    expect(live.textContent).toBe("Deniz moved Galata Tower to Day 2");

    remoteEdit("u2", (d, origin) => {
      addPlace(d, { name: "Çiya Sofrası", category: "food", dayId: dayIds[1] }, origin);
    });
    expect(live.textContent).toBe("Deniz added Çiya Sofrası to Day 2");
  });

  it("set times show as set and estimated times follow stays", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Breakfast", category: "food", stayMinutes: 30, dayId: dayIds[0] }, "u1");
    const galata = addPlace(doc, { name: "Galata Tower", category: "sight", stayMinutes: 60, dayId: dayIds[0], time: "07:00" }, "u1");
    addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const time = (name: string) => within(row(name)).getByTestId("place-time").textContent;
    // No default start: an untimed stop before any set time has no time.
    expect(screen.queryByLabelText(/^Start time/)).toBeNull();
    expect(time("Breakfast")).toBe("Set a time");
    expect(time("Galata Tower")).toBe("07:00");
    expect(time("Karaköy Lokantası")).toBe("≈ estimated, 08:00");

    remoteEdit("u2", (d, origin) => updatePlace(d, galata, { stayMinutes: 90 }, origin));
    expect(time("Karaköy Lokantası")).toBe("≈ estimated, 08:30");

    remoteEdit("u2", (d, origin) => setPlaceTime(d, galata, "10:15", origin));
    expect(time("Galata Tower")).toBe("10:15");
    expect(time("Karaköy Lokantası")).toBe("≈ estimated, 11:45");
  });

  it("drag and drop adds no screen reader output of its own", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />, "tr");
    expect(document.querySelector('[aria-live="assertive"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/draggable|space bar/i);
  });

  it("a remote delete is announced with the member's name; my own delete from another device is not", () => {
    const { doc, dayIds } = newTrip();
    const a = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    const b = addPlace(doc, { name: "Pera Museum", category: "museum", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const live = screen.getByTestId("announcer");
    remoteEdit("u2", (d, origin) => deletePlace(d, a, origin));
    expect(live.textContent).toBe("Deniz deleted Galata Tower");
    remoteEdit("u1", (d, origin) => deletePlace(d, b, origin));
    expect(names(day(1))).toEqual([]);
    expect(live.textContent).toBe("Deniz deleted Galata Tower");
  });

  it("a restored place is announced as the restorer's, even when I added it", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const live = screen.getByTestId("announcer");
    const deniz = remotePeer("u2");
    const undo = createUndo(deniz.doc, "u2");
    deletePlace(deniz.doc, id, "u2");
    deniz.push();
    expect(live.textContent).toBe("Deniz deleted Galata Tower");
    undo.undo();
    deniz.push();
    expect(names(day(1))).toEqual(["Galata Tower"]);
    expect(live.textContent).toBe("Deniz added Galata Tower to Day 1");
    undo.destroy();
  });

  it("Open in Google Maps links to the place URL in a new tab", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", lat: 41.0256, lng: 28.9744, dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    open("Galata Tower");
    const link = within(screen.getByRole("region", { name: "Details for Galata Tower" })).getByRole("link", { name: /^Open in Google Maps/ });
    expect(link.getAttribute("href")).toBe(placeUrl(fake.view.days[0].places[0]));
    expect(link.getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=41.0256,28.9744");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("opens in a new tab");
    expect(link.textContent).toContain("Galata Tower");
  });

  it("an unknown user sees the trip read-only", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], time: "10:00" }, "u1");
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByText("Galata Tower")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /time for Galata Tower/ })).toBeNull();
    expect(within(row("Galata Tower")).getByTestId("place-time").textContent).toBe("10:00");
    open("Galata Tower");
    expect(screen.getByRole("region", { name: "Details for Galata Tower" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete Galata Tower" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(screen.getByText(/Editing is off/)).toBeTruthy();
  });

  it("drag drops land before a row, take its place when moving down, or go to the end of a list", () => {
    const { doc, dayIds } = newTrip();
    const [a, b, c] = ["A", "B", "C"].map((name) => addPlace(doc, { name, category: "sight", dayId: dayIds[0] }, "u1"));
    const view = fake.view;
    expect(dropTarget(view, c, placeDropId(a))).toEqual({ dayId: dayIds[0], beforeId: a });
    expect(dropTarget(view, a, placeDropId(b))).toEqual({ dayId: dayIds[0], afterId: b });
    expect(dropTarget(view, a, placeDropId(a))).toBeNull();
    expect(dropTarget(view, b, listDropId(dayIds[1]))).toEqual({ dayId: dayIds[1] });
    expect(dropTarget(view, b, listDropId(null))).toEqual({ dayId: null });
    expect(dropPlace(doc, fake.view, a, placeDropId(b), "u1")).toBe(true);
    expect(fake.view.days[0].places.map((p) => p.id)).toEqual([b, a, c]);
  });
});

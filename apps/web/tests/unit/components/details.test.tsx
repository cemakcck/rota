import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addPlace, deletePlace, movePlace } from "@rota/trip";
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
  at("");
});

const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
const nameButton = (name: string) => within(row(name)).getByRole("button", { name });
const names = (region: HTMLElement) => within(region).queryAllByTestId("place-name").map((e) => e.textContent);
const day = (n: number) => screen.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) });
const details = (name: string) => screen.getByRole("region", { name: `Details for ${name}` });
const noDetails = () => screen.queryByRole("region", { name: /^Details for / });
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

/** Opening hours by OSM id; every other request (routes) fails, so legs are straight-line estimates. */
function stubHours(hours: Record<string, string | null>) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/hours?ids=")) {
      const ids = url.slice("/api/hours?ids=".length).split(",");
      return new Response(JSON.stringify({ hours: Object.fromEntries(ids.map((id) => [id, hours[id] ?? null])) }), { status: 200 });
    }
    return new Response(null, { status: 503 });
  });
}

describe("place details", () => {
  it("clicking a row opens details with arrive, stay, leg, hours, tags, note, Google Maps, Move, Delete", async () => {
    const { doc, dayIds } = newTrip({ days: 1 });
    // Monday 30 Nov 2026.
    doc.getMap("meta").set("startDate", "2026-11-30");
    addPlace(doc, { name: "Breakfast", category: "food", stayMinutes: 45, dayId: dayIds[0], time: "09:00", lat: 41.0228, lng: 28.9779 }, "u1");
    const museum = addPlace(
      doc,
      { name: "Pera Museum", category: "museum", tags: ["art"], stayMinutes: 60, dayId: dayIds[0], time: "10:30", lat: 41.0317, lng: 28.9752, osmId: "n9001" },
      "u2",
    );
    stubHours({ n9001: "Tu-Su 10:00-19:00" });
    renderIntl(<TripScreen tripId="t1" />);
    expect(noDetails()).toBeNull();

    fireEvent.click(row("Pera Museum"));
    const panel = details("Pera Museum");
    expect(nameButton("Pera Museum").getAttribute("aria-expanded")).toBe("true");
    expect(fake.awareness.getLocalState()?.editing).toBe(museum);
    expect(within(panel).getByTestId("details-chip").textContent).toBe("2 · Day 1 · Museum");
    expect((within(panel).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Pera Museum");
    expect(within(panel).getByText("Added by Deniz")).toBeTruthy();
    expect((within(panel).getByRole("textbox", { name: "Arrive" }) as HTMLInputElement).value).toBe("10:30");
    expect((within(panel).getByRole("combobox", { name: "Stay" }) as HTMLSelectElement).value).toBe("60");
    expect(within(panel).getByTestId("details-leg").textContent).toMatch(/min walk/);
    expect(await within(panel).findByText("Closed on Mondays")).toBeTruthy();
    expect(within(panel).getByTestId("details-hours").textContent).toBe("Closed");
    expect(within(panel).getByRole("button", { name: "Remove tag art" })).toBeTruthy();
    expect(within(panel).getByRole("textbox", { name: "Tags" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Add a note to Pera Museum" })).toBeTruthy();
    expect(within(panel).getByRole("link", { name: /^Open in Google Maps/ }).getAttribute("target")).toBe("_blank");
    expect(within(panel).getByRole("button", { name: "Move Pera Museum to…" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Move Pera Museum up" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Move Pera Museum down" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(panel).getByRole("button", { name: "Delete Pera Museum" })).toBeTruthy();
    // The row itself stays one line: nothing opens under it.
    expect(within(row("Pera Museum")).queryByRole("link")).toBeNull();

    // Tags, name and category save as they change.
    const tags = within(panel).getByRole("textbox", { name: "Tags" });
    fireEvent.change(tags, { target: { value: "views" } });
    fireEvent.keyDown(tags, { key: "Enter" });
    expect(fake.view.days[0].places[1].tags).toEqual(["art", "views"]);
    fireEvent.click(within(panel).getByRole("button", { name: "Remove tag art" }));
    expect(fake.view.days[0].places[1].tags).toEqual(["views"]);
    fireEvent.click(within(panel).getByRole("button", { name: /^Change category/ }));
    fireEvent.click(within(panel).getByRole("radio", { name: "Sight" }));
    expect(fake.view.days[0].places[1].category).toBe("sight");
    const name = within(panel).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "Pera Müzesi" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(fake.view.days[0].places[1].name).toBe("Pera Müzesi");
    expect(details("Pera Müzesi")).toBeTruthy();
    // An empty name is not saved.
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.blur(name);
    expect(fake.view.days[0].places[1].name).toBe("Pera Müzesi");

    // Move up in the panel reorders, re-times and announces.
    fireEvent.click(within(details("Pera Müzesi")).getByRole("button", { name: "Move Pera Müzesi up" }));
    expect(names(day(1))).toEqual(["Pera Müzesi", "Breakfast"]);
    expect(screen.getByTestId("plan-status").textContent).toMatch(/^Pera Müzesi now at \d\d:\d\d, position 1 of 2$/);
  });

  it("stay select updates the timeline", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "A", category: "sight", stayMinutes: 60, dayId: dayIds[0], time: "09:00" }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(row("B")).getByTestId("place-time").textContent).toBe("≈ estimated, 10:00");
    fireEvent.click(nameButton("A"));
    fireEvent.change(within(details("A")).getByRole("combobox", { name: "Stay" }), { target: { value: "90" } });
    expect(fake.view.days[0].places[0].stayMinutes).toBe(90);
    expect(within(row("A")).getByText("1 h 30 min")).toBeTruthy();
    expect(within(row("B")).getByTestId("place-time").textContent).toBe("≈ estimated, 10:30");
  });

  it("time field sets, changes and clears the stop's time", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "A", category: "sight", stayMinutes: 60, dayId: dayIds[0], time: "09:00" }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const status = screen.getByTestId("plan-status");
    fireEvent.click(nameButton("B"));
    const time = () => within(details("B")).getByRole("textbox", { name: "Arrive" }) as HTMLInputElement;
    const set = (value: string) => {
      fireEvent.change(time(), { target: { value } });
      fireEvent.keyDown(time(), { key: "Enter" });
    };

    // Untimed: prefilled with the estimate, marked as one; leaving it untouched pins nothing.
    expect(time().value).toBe("10:00");
    expect(within(details("B")).getByText("estimated")).toBeTruthy();
    fireEvent.blur(time());
    expect(fake.view.days[0].places[1].time).toBeNull();
    // Enter sets the estimate.
    fireEvent.keyDown(time(), { key: "Enter" });
    expect(fake.view.days[0].places[1].time).toBe("10:00");
    expect(status.textContent).toBe("B now at 10:00, position 2 of 2");

    // Changing it moves the stop into time order.
    set("8.30");
    expect(names(day(1))).toEqual(["B", "A"]);
    expect(time().value).toBe("08:30");
    expect(status.textContent).toBe("B now at 08:30, position 1 of 2");

    // Too early to get there: flagged, not blocked.
    set("09:30");
    expect(names(day(1))).toEqual(["A", "B"]);
    expect(within(details("B")).getByText("You'd arrive ≈ 30 min late (from A)")).toBeTruthy();

    // Something that is not a time says why, linked to the field, and saves nothing.
    set("25:00");
    expect(time().getAttribute("aria-invalid")).toBe("true");
    const error = within(details("B")).getByText("Enter a time like 09:30, or leave it empty.");
    expect(time().getAttribute("aria-describedby")).toContain(error.id);
    expect(fake.view.days[0].places[1].time).toBe("09:30");

    // Empty clears it.
    set("");
    expect(fake.view.days[0].places[1].time).toBeNull();
    expect(status.textContent).toBe("B has no set time");
    expect(time().getAttribute("aria-invalid")).toBeNull();
  });

  it("Escape closes and returns focus to the row", async () => {
    const { doc, dayIds } = newTrip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    fireEvent.click(nameButton("A"));
    await nextFrame();
    // Focus moves into the panel.
    expect(details("A").contains(document.activeElement)).toBe(true);
    // Another row switches it.
    fireEvent.click(row("B"));
    expect(details("B")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Details for A" })).toBeNull();
    expect(nameButton("A").getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(nameButton("A"));
    const close = within(details("A")).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(noDetails()).toBeNull();
    expect(fake.awareness.getLocalState()?.editing).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(nameButton("A")));

    // ✕ does the same.
    fireEvent.click(nameButton("A"));
    expect(fake.awareness.getLocalState()?.editing).toBe(a);
    fireEvent.click(within(details("A")).getByRole("button", { name: "Close" }));
    expect(noDetails()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(nameButton("A")));
  });

  it("remote delete closes the panel", async () => {
    const { doc, dayIds } = newTrip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(nameButton("A"));
    within(details("A")).getByRole("button", { name: "Close" }).focus();
    remoteEdit("u2", (d, origin) => deletePlace(d, a, origin));
    expect(noDetails()).toBeNull();
    expect(fake.awareness.getLocalState()?.editing).toBeNull();
    // Focus is not lost with the panel.
    await waitFor(() => expect(document.activeElement?.id).toBe("main"));
  });

  it("remote move to another day keeps the panel on the place and switches the view to that day", () => {
    const { doc, dayIds } = newTrip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[1] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(nameButton("A"));
    remoteEdit("u2", (d, origin) => movePlace(d, a, { dayId: dayIds[1] }, origin));
    expect(within(details("A")).getByTestId("details-chip").textContent).toBe("2 · Day 2 · Sight");
    expect(window.location.search).toBe(`?view=day&day=${dayIds[1]}`);
    expect(names(day(2))).toEqual(["B", "A"]);
    expect(nameButton("A").getAttribute("aria-expanded")).toBe("true");

    // Choosing another view closes it.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Trip" })).getByRole("button", { name: /^Day 1 · / }));
    expect(noDetails()).toBeNull();
  });

  it("delete shows Undo and Undo restores", async () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "A", category: "sight", tags: ["views"], dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(nameButton("A"));
    fireEvent.click(within(details("A")).getByRole("button", { name: "Delete A" }));
    expect(noDetails()).toBeNull();
    expect(names(day(1))).toEqual([]);
    expect(screen.getByText("A deleted.")).toBeTruthy();
    const undo = screen.getByRole("button", { name: "Undo deleting A" });
    expect(document.activeElement).toBe(undo);
    fireEvent.click(undo);
    expect(names(day(1))).toEqual(["A"]);
    expect(fake.view.days[0].places[0].tags).toEqual(["views"]);
    // The panel stays closed; focus goes to the restored row.
    expect(noDetails()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(nameButton("A")));
  });

  it("read-only users see no edit controls", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "A", category: "sight", tags: ["views"], dayId: dayIds[0], time: "10:00" }, "u2");
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(nameButton("A"));
    const panel = details("A");
    expect(within(panel).getByRole("heading", { name: "A" })).toBeTruthy();
    expect(within(panel).getByTestId("details-time").textContent).toBe("10:00");
    expect(within(panel).getByText("views")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: /^Open in Google Maps/ })).toBeTruthy();
    expect(within(panel).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(panel).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(panel).queryAllByRole("radio")).toHaveLength(0);
    // Only Close is a button.
    expect(within(panel).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Close"]);
    expect(fake.awareness.getLocalState()?.editing ?? null).toBeNull();
  });

  it("pin click opens details", async () => {
    const { doc, dayIds } = newTrip();
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], lat: 41.0256, lng: 28.9742 }, "u1");
    const chora = addPlace(doc, { name: "Chora Church", category: "museum", dayId: dayIds[1], lat: 41.0312, lng: 28.9393 }, "u1");
    const map = fakeMap();
    renderIntl(
      <MapLoaderContext.Provider value={map.load}>
        <TripScreen tripId="t1" />
      </MapLoaderContext.Provider>,
    );
    await waitFor(() => expect(document.querySelectorAll("[data-pin]")).toHaveLength(2));
    fireEvent.click(document.querySelector<HTMLElement>(`[data-pin="${tower}"]`)!);
    expect(details("Galata Tower")).toBeTruthy();
    expect(row("Galata Tower").getAttribute("aria-current")).toBe("true");
    // A pin on another day switches the panel and the view.
    fireEvent.click(document.querySelector<HTMLElement>(`[data-pin="${chora}"]`)!);
    expect(details("Chora Church")).toBeTruthy();
    expect(window.location.search).toBe(`?view=day&day=${dayIds[1]}`);
  });
});

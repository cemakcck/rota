import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { addPlace, createUndo, dayUrls, deletePlace, movePlace, placeUrl, setPlaceTime, updatePlace } from "@rota/trip";
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
import { dropTarget, listDropId, placeDropId } from "@/components/trip/plan";

afterEach(cleanup);

const day = (n: number) => screen.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) });
const names = (region: HTMLElement) => within(region).queryAllByTestId("place-name").map((e) => e.textContent);
const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;

describe("itinerary", () => {
  it("adds, edits category and tags, deletes a place, and Undo restores it", () => {
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);

    const form = screen.getByRole("form", { name: "Add a place" });
    fireEvent.change(within(form).getByLabelText("Place name"), { target: { value: "  Galata Tower " } });
    fireEvent.change(within(form).getByLabelText("Add to"), { target: { value: fake.view.days[0].id } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(names(day(1))).toEqual(["Galata Tower"]);

    fireEvent.click(screen.getByRole("button", { name: "Edit Galata Tower" }));
    const editor = screen.getByRole("form", { name: "Edit Galata Tower" });
    fireEvent.click(within(editor).getByRole("radio", { name: "Museum" }));
    const tags = within(editor).getByLabelText("Tags");
    fireEvent.change(tags, { target: { value: "views" } });
    fireEvent.keyDown(tags, { key: "Enter" });
    fireEvent.change(tags, { target: { value: "sunset, Views" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(fake.view.days[0].places[0]).toMatchObject({ name: "Galata Tower", category: "museum", tags: ["views", "sunset"] });
    expect(screen.queryByRole("form", { name: "Edit Galata Tower" })).toBeNull();
    expect(within(row("Galata Tower")).getByRole("img", { name: "Museum" })).toBeTruthy();
    expect(within(row("Galata Tower")).getByText("sunset")).toBeTruthy();

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

  it("keyboard move via Move to… and up/down buttons", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    const up = screen.getByRole("button", { name: "Move Karaköy Lokantası up" });
    fireEvent.click(up);
    expect(names(day(1))).toEqual(["Karaköy Lokantası", "Galata Tower"]);
    // At the top it stays focusable (aria-disabled), so focus is not lost.
    expect(up.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(up);
    expect(names(day(1))).toEqual(["Karaköy Lokantası", "Galata Tower"]);
    fireEvent.click(screen.getByRole("button", { name: "Move Karaköy Lokantası down" }));
    expect(names(day(1))).toEqual(["Galata Tower", "Karaköy Lokantası"]);

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

  it("remote delete while the Move dialog is open closes it", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
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
    fireEvent.click(screen.getByRole("button", { name: "Move Galata Tower to…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Ideas" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move" }));
    expect(live.textContent).toBe("Deniz moved Galata Tower to Day 2");

    remoteEdit("u2", (d, origin) => {
      addPlace(d, { name: "Çiya Sofrası", category: "food", dayId: dayIds[1] }, origin);
    });
    expect(live.textContent).toBe("Deniz added Çiya Sofrası to Day 2");
  });

  it("a 120-character Turkish place name wraps without overflow", () => {
    const { doc, dayIds } = newTrip();
    const long = "Şişli'deki ığdır usulü çağ kebabı yapan küçük dükkânın üst katındaki gün batımı terası ".repeat(3).slice(0, 120);
    expect(long).toHaveLength(120);
    addPlace(doc, { name: long, category: "food", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />, "tr");
    const name = screen.getByTestId("place-name");
    expect(name.textContent).toBe(long.trim());
    expect(name.className).toContain("[overflow-wrap:anywhere]");
    // Every box between the name and the row may shrink below its content's width.
    for (let el = name.parentElement; el && el.tagName !== "LI"; el = el.parentElement) expect(el.className).toContain("min-w-0");
    expect(name.closest("li")!.className).toContain("min-w-0");
  });

  it("set times show as set and estimated times follow stays", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Breakfast", category: "food", stayMinutes: 30, dayId: dayIds[0] }, "u1");
    const galata = addPlace(doc, { name: "Galata Tower", category: "sight", stayMinutes: 60, dayId: dayIds[0], time: "07:00" }, "u1");
    addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    // No default start: an untimed stop before any set time has no time.
    expect(screen.queryByLabelText(/^Start time/)).toBeNull();
    expect(within(row("Breakfast")).queryByText(/\d\d:\d\d/)).toBeNull();
    expect(within(row("Galata Tower")).getByText("07:00")).toBeTruthy();
    expect(within(row("Karaköy Lokantası")).getByText("around 08:00")).toBeTruthy();

    const stay = screen.getByLabelText("Stay at Galata Tower, in minutes");
    fireEvent.change(stay, { target: { value: "90" } });
    fireEvent.blur(stay);
    expect(within(row("Karaköy Lokantası")).getByText("around 08:30")).toBeTruthy();

    remoteEdit("u2", (d, origin) => setPlaceTime(d, galata, "10:15", origin));
    expect(within(row("Galata Tower")).getByText("10:15")).toBeTruthy();
    expect(within(row("Karaköy Lokantası")).getByText("around 11:45")).toBeTruthy();
  });

  it("stay fields keep focus and the typed value through saves and remote updates", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", stayMinutes: 60, dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    const stay = screen.getByLabelText("Stay at Galata Tower, in minutes") as HTMLInputElement;
    stay.focus();
    fireEvent.change(stay, { target: { value: "90" } });
    fireEvent.keyDown(stay, { key: "Enter" });
    expect(fake.view.days[0].places[0].stayMinutes).toBe(90);
    expect(document.activeElement).toBe(stay);

    // Half-typed, then someone else changes the same stay: the field keeps what is being typed.
    fireEvent.change(stay, { target: { value: "12" } });
    remoteEdit("u2", (d, origin) => updatePlace(d, id, { stayMinutes: 30 }, origin));
    expect(document.activeElement).toBe(stay);
    expect(stay.value).toBe("12");
    fireEvent.blur(stay);
    expect(fake.view.days[0].places[0].stayMinutes).toBe(12);

    // Not focused: the field shows changes made elsewhere; focusing without typing never reverts them.
    remoteEdit("u2", (d, origin) => updatePlace(d, id, { stayMinutes: 45 }, origin));
    expect(stay.value).toBe("45");
    stay.focus();
    remoteEdit("u2", (d, origin) => updatePlace(d, id, { stayMinutes: 50 }, origin));
    fireEvent.blur(stay);
    expect(fake.view.days[0].places[0].stayMinutes).toBe(50);
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
    const link = within(row("Galata Tower")).getByRole("link", { name: /^Open in Google Maps/ });
    expect(link.getAttribute("href")).toBe(placeUrl(fake.view.days[0].places[0]));
    expect(link.getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=41.0256,28.9744");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("opens in a new tab");
    expect(link.textContent).toContain("Galata Tower");
  });

  it("a day with 12 stops shows two Google Maps buttons", () => {
    const { doc, dayIds } = newTrip();
    for (let i = 0; i < 12; i++) addPlace(doc, { name: `Stop ${i + 1}`, category: "sight", lat: 41 + i / 100, lng: 29, dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const links = within(day(1)).getAllByRole("link", { name: /Open day in Google Maps/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(dayUrls(fake.view.days[0], "walk"));
    expect(links.map((l) => l.textContent)).toEqual([expect.stringContaining("part 1 of 2"), expect.stringContaining("part 2 of 2")]);
    for (const l of links) expect(l.getAttribute("target")).toBe("_blank");
    // Day 2 has no stops, so no directions.
    expect(within(day(2)).queryByRole("link", { name: /Open day in Google Maps/ })).toBeNull();
  });

  it("an unknown user sees the trip read-only", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByText("Galata Tower")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete Galata Tower" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Add a place" })).toBeNull();
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
    movePlace(doc, a, dropTarget(fake.view, a, placeDropId(b))!, "u1");
    expect(fake.view.days[0].places.map((p) => p.id)).toEqual([b, a, c]);
  });
});

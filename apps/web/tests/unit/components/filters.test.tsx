import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addPlace } from "@rota/trip";
import { MapLoaderContext } from "@/components/map/engine";
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

afterEach(cleanup);

const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
const hidden = (name: string) => within(row(name)).queryByText("Hidden by filters") !== null;

describe("filters", () => {
  it("category filter dims places and reports how many are hidden", async () => {
    const { doc, dayIds } = newTrip();
    const lokanta = addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[0], lat: 41.0228, lng: 28.9779 }, "u1");
    addPlace(doc, { name: "Pera Museum", category: "museum", dayId: dayIds[0], lat: 41.0317, lng: 28.9752 }, "u1");
    addPlace(doc, { name: "Istanbul Modern", category: "museum", dayId: null, lat: 41.0267, lng: 28.9836 }, "u1");
    const map = fakeMap();
    renderIntl(
      <MapLoaderContext.Provider value={map.load}>
        <TripScreen tripId="t1" />
      </MapLoaderContext.Provider>,
    );
    const pinned = () => [...document.querySelectorAll<HTMLElement>("[data-pin]")].map((p) => p.dataset.pin);
    expect(screen.getByRole("region", { name: "Map" })).toBeTruthy();
    await waitFor(() => expect(pinned()).toHaveLength(3));
    expect(screen.queryByText(/hidden by filters/)).toBeNull();

    const filters = screen.getByRole("group", { name: "Category" });
    const food = within(filters).getByRole("button", { name: "Food" });
    fireEvent.click(food);
    expect(food.getAttribute("aria-pressed")).toBe("true");
    expect(hidden("Karaköy Lokantası")).toBe(false);
    expect(hidden("Pera Museum")).toBe(true);
    expect(hidden("Istanbul Modern")).toBe(true);
    // Dimmed, not removed: still in the list.
    expect(row("Pera Museum").dataset.dimmed).toBe("true");
    expect(row("Karaköy Lokantası").dataset.dimmed).toBeUndefined();
    expect(screen.getByText("2 places hidden by filters")).toBeTruthy();
    // Filtered places leave the map.
    expect(pinned()).toEqual([lokanta]);

    fireEvent.click(within(filters).getByRole("button", { name: "Museum" }));
    expect(screen.queryByText(/hidden by filters/)).toBeNull();

    fireEvent.click(within(filters).getByRole("button", { name: "Museum" }));
    expect(screen.getByText("2 places hidden by filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByText(/hidden by filters/)).toBeNull();
    expect(food.getAttribute("aria-pressed")).toBe("false");
  });

  it("tag filter matches tags case-insensitively", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", tags: ["Views"], dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Çiya Sofrası", category: "food", tags: ["lunch"], dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Rumeli Hisarı", category: "sight", tags: ["views"], dayId: dayIds[1] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const tag = screen.getByLabelText("Tag");
    expect(within(tag).getAllByRole("option").map((o) => o.textContent)).toEqual(["All tags", "lunch", "Views"]);
    fireEvent.change(tag, { target: { value: "views" } });
    expect(hidden("Galata Tower")).toBe(false);
    expect(hidden("Rumeli Hisarı")).toBe(false);
    expect(hidden("Çiya Sofrası")).toBe(true);
    expect(screen.getByText("1 place hidden by filters")).toBeTruthy();
  });

  it("Add place is disabled when the trip is full", () => {
    const { doc } = newTrip();
    doc.transact(() => {
      for (let i = 0; i < 200; i++) addPlace(doc, { name: `Place ${i}`, category: "other", dayId: null }, "u1");
    });
    renderIntl(<TripScreen tripId="t1" />);
    const form = screen.getByRole("form", { name: "Add a place" });
    expect(within(form).getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
    expect(within(form).getByLabelText("Place name")).toHaveProperty("disabled", true);
    expect(within(form).getByText("This trip is full")).toBeTruthy();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addPlace, setPlaceTime } from "@rota/trip";
import { suggestedFor } from "@/components/trip/SearchBar";
import { MapLoaderContext } from "@/components/map/engine";
import { renderIntl } from "../components/helpers";
import { fake, newTrip, refresh, useFakeTrip } from "../components/tripHarness";
import { fakeMap } from "./fakeMap";

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

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
const pin = (id: string) => document.querySelector<HTMLElement>(`[data-pin="${id}"]`)!;

async function open() {
  const { doc, dayIds } = newTrip();
  const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], lat: 41.0256, lng: 28.9742 }, "u1");
  const chora = addPlace(doc, { name: "Chora Church", category: "museum", dayId: dayIds[1], lat: 41.0312, lng: 28.9393 }, "u1");
  const map = fakeMap();
  renderIntl(
    <MapLoaderContext.Provider value={map.load}>
      <TripScreen tripId="t1" />
    </MapLoaderContext.Provider>,
  );
  await waitFor(() => expect(document.querySelectorAll("[data-pin]")).toHaveLength(1));
  return { doc, dayIds, tower, chora, map };
}

describe("trip screen map", () => {
  it("a pin selects its row and shows its day, and a row its pin", async () => {
    const { tower, chora, map } = await open();
    const rail = screen.getByRole("navigation", { name: "Trip" });
    // The map follows the view (the rail chooses it): the first day, its pin only.
    expect(screen.queryByRole("group", { name: "Day shown on the map" })).toBeNull();
    expect(document.querySelectorAll("[data-pin]")).toHaveLength(1);
    expect(map.state.routes).toEqual([]);

    fireEvent.click(pin(tower));
    expect(row("Galata Tower").getAttribute("aria-current")).toBe("true");
    expect(pin(tower).dataset.selected).toBe("true");
    // The pin opened the details panel; the map leaves room for it.
    expect(screen.getByRole("region", { name: "Details for Galata Tower" })).toBeTruthy();

    // Another day on the rail: the map shows that day, fitted.
    fireEvent.click(within(rail).getByRole("button", { name: /^Day 2 · / }));
    expect(document.querySelectorAll("[data-pin]")).toHaveLength(1);
    expect(map.state.fits.at(-1)).toEqual([28.9393, 41.0312, 28.9393, 41.0312]);
    fireEvent.click(pin(chora));
    expect(row("Chora Church").getAttribute("aria-current")).toBe("true");
    expect(pin(chora).dataset.selected).toBe("true");
    expect(within(rail).getByRole("button", { name: /^Day 2 · / }).getAttribute("aria-current")).toBe("true");

    // The whole trip: every pin on the map and every day in the list; clicking a row (not one of its buttons) selects it.
    fireEvent.click(within(rail).getByRole("button", { name: "Whole trip on map" }));
    expect(window.location.search).toBe("?view=all");
    expect(document.querySelectorAll("[data-pin]")).toHaveLength(2);
    fireEvent.click(screen.getByText("Galata Tower", { selector: "[data-testid=place-name]" }).closest("li")!.querySelector("[data-testid=place-sub]")!);
    expect(row("Galata Tower").getAttribute("aria-current")).toBe("true");
    expect(row("Chora Church").getAttribute("aria-current")).toBeNull();
    expect(pin(tower).dataset.selected).toBe("true");
    fireEvent.click(within(row("Chora Church")).getByTestId("place-time"));
    expect(row("Galata Tower").getAttribute("aria-current")).toBe("true");
  });

  it("a place added on the map gets its coordinates; nothing is added while editing is off", async () => {
    const { dayIds } = await open();
    const surface = document.querySelector<HTMLElement>("[data-pin]")!.parentElement!;
    fireEvent.contextMenu(surface, { clientX: 100, clientY: 90 });
    const dialog = await screen.findByRole("dialog", { name: "Add a place here" });
    fireEvent.change(within(dialog).getByLabelText("Place name"), { target: { value: "Ferry pier" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(fake.view.days[0].places.at(-1)).toMatchObject({ name: "Ferry pier", lat: 41.1, lng: 29, category: "other", dayId: dayIds[0] });
    expect(row("Ferry pier").getAttribute("aria-current")).toBe("true");

    fake.userId = null;
    refresh();
    await waitFor(() => expect(document.querySelectorAll("[data-pin]")).toHaveLength(2));
    fireEvent.contextMenu(document.querySelector<HTMLElement>("[data-pin]")!.parentElement!, { clientX: 100, clientY: 90 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a place added on the map asks its time (the suggestion, editable) and stay before it is added", async () => {
    const { doc, dayIds, tower } = await open();
    setPlaceTime(doc, tower, "10:00", "u1");
    const surface = document.querySelector<HTMLElement>("[data-pin]")!.parentElement!;
    fireEvent.contextMenu(surface, { clientX: 100, clientY: 90 });
    const dialog = await screen.findByRole("dialog", { name: "Add a place here" });
    fireEvent.change(within(dialog).getByLabelText("Place name"), { target: { value: "Ferry pier" } });
    const time = within(dialog).getByLabelText("Time") as HTMLInputElement;
    // Prefilled with the time suggested after Day 1's last stop (its end + travel to the point).
    const suggested = suggestedFor(fake.view.days[0], [], { lat: 41.1, lng: 29 });
    expect(suggested).toMatch(/^\d\d:\d[05]$/);
    expect(time.value).toBe(suggested);
    // An invalid time is said, and nothing is added.
    fireEvent.change(time, { target: { value: "25:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a time like 09:30, or leave it empty.");
    expect(fake.view.days[0].places).toHaveLength(1);
    fireEvent.change(time, { target: { value: "16:30" } });
    fireEvent.click(within(within(dialog).getByRole("group", { name: "Stay" })).getByRole("button", { name: "30 min" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(fake.view.days[0].places.at(-1)).toMatchObject({ name: "Ferry pier", time: "16:30", stayMinutes: 30, dayId: dayIds[0] });

    // Ideas have no time: the field goes.
    fireEvent.contextMenu(surface, { clientX: 100, clientY: 90 });
    const again = await screen.findByRole("dialog", { name: "Add a place here" });
    fireEvent.change(within(again).getByLabelText("Add to"), { target: { value: "" } });
    expect(within(again).queryByLabelText("Time")).toBeNull();
  });

  it("phones switch between the map with the list's sheet and the list alone", async () => {
    await open();
    const toggle = screen.getByRole("group", { name: "Show" });
    const map = screen.getByRole("region", { name: "Map" });
    expect(screen.getByRole("button", { name: "Resize the list" })).toBeTruthy();
    fireEvent.click(within(toggle).getByRole("button", { name: "List" }));
    expect(within(toggle).getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
    expect(map.className).toContain("max-lg:hidden");
    expect(screen.queryByRole("button", { name: "Resize the list" })).toBeNull();
    fireEvent.click(within(toggle).getByRole("button", { name: "Map" }));
    expect(map.className).not.toContain("max-lg:hidden");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addPlace } from "@rota/trip";
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

afterEach(cleanup);

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
  await waitFor(() => expect(document.querySelectorAll("[data-pin]")).toHaveLength(2));
  return { doc, dayIds, tower, chora, map };
}

describe("trip screen map", () => {
  it("a pin selects its row, and a row its pin and day", async () => {
    const { tower, chora, map } = await open();
    const days = screen.getByRole("group", { name: "Day shown on the map" });
    // The map opens on the first day.
    expect(within(days).getByRole("button", { name: "Day 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(map.state.route).toBeNull();

    fireEvent.click(pin(tower));
    expect(row("Galata Tower").getAttribute("aria-current")).toBe("true");
    expect(pin(tower).className).toContain("outline-ink");

    // Clicking a row (not one of its buttons) selects it, and shows its day on the map.
    fireEvent.click(screen.getByText("Chora Church"));
    expect(row("Chora Church").getAttribute("aria-current")).toBe("true");
    expect(row("Galata Tower").getAttribute("aria-current")).toBeNull();
    expect(pin(chora).className).toContain("outline-ink");
    expect(within(days).getByRole("button", { name: "Day 2" }).getAttribute("aria-pressed")).toBe("true");
    expect(map.state.fits.at(-1)).toEqual([28.9393, 41.0312, 28.9393, 41.0312]);
    fireEvent.click(within(row("Galata Tower")).getByRole("button", { name: "Edit Galata Tower" }));
    expect(row("Chora Church").getAttribute("aria-current")).toBe("true");

    fireEvent.click(within(days).getByRole("button", { name: "All days" }));
    expect(within(days).getByRole("button", { name: "All days" }).getAttribute("aria-pressed")).toBe("true");
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
    await waitFor(() => expect(document.querySelectorAll("[data-pin]")).toHaveLength(3));
    fireEvent.contextMenu(document.querySelector<HTMLElement>("[data-pin]")!.parentElement!, { clientX: 100, clientY: 90 });
    expect(screen.queryByRole("dialog")).toBeNull();
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

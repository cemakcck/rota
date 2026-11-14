import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderIntl, stubFetch } from "./helpers";
import { fake, newTrip, useFakeTrip } from "./tripHarness";

const push = vi.fn();
vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/authClient", () => ({
  useUserId: () => fake.userId,
  useUserState: () => ({ userId: fake.userId, signedOut: false }),
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { TripScreen } from "@/components/trip/TripScreen";
import { NewTripForm } from "@/components/trips/NewTripForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const galata = { name: "Galata Kulesi", label: "Bereketzade, Beyoğlu, İstanbul, Türkiye", lat: 41.0256, lng: 28.9742, osmId: "w32514112", category: "sight" };
const pera = { name: "Pera Müzesi", label: "Meşrutiyet Caddesi 65, Beyoğlu, İstanbul, Türkiye", lat: 41.0317, lng: 28.9752, osmId: "n12", category: "museum" };

describe("place search", () => {
  it("search results navigate with arrow keys and Enter adds the place with coordinates and category", async () => {
    const { dayIds } = newTrip();
    const { fn, calls } = stubFetch({ "GET /api/geocode?q=Galata&lang=en": () => ({ body: { results: [galata, pera] } }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);

    const box = screen.getByRole("combobox", { name: "Add a place to Day 1…" });
    expect(box.getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(box, { target: { value: "Galata" } });
    const list = await screen.findByRole("listbox");
    expect(calls.filter((c) => c.key.includes("/api/geocode"))).toHaveLength(1);
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(box.getAttribute("aria-controls")).toBe(list.id);
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Galata Kulesi"), expect.stringContaining("Pera Müzesi")]);
    expect(within(options[1]).getByText(pera.label)).toBeTruthy();
    expect(within(options[1]).getByRole("img", { name: "Museum" })).toBeTruthy();

    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(options[1].id);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    // The pick opens the add step (time, stay); Enter there adds it to the day.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(fake.view.days[0].places).toHaveLength(0);
    fireEvent.keyDown(screen.getByLabelText("Time"), { key: "Enter" });

    expect(fake.view.days[0].places).toHaveLength(1);
    expect(fake.view.days[0].places[0]).toMatchObject({
      name: "Pera Müzesi",
      lat: pera.lat,
      lng: pera.lng,
      osmId: "n12",
      address: pera.label,
      category: "museum",
      dayId: dayIds[0],
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((box as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(box);
  });

  it("the same place returned twice (same OSM type and id) is listed once", async () => {
    newTrip();
    const pier = { name: "Karakoy Kabatas Eminonu Ferries Pier", label: "Karaköy, Beyoğlu, İstanbul", lat: 41.0213, lng: 28.9768, osmId: "n555", category: "other" };
    // A node and a way may share a number: those are different places.
    const way = { ...pier, name: "Karaköy Pier building", osmId: "w555" };
    const { fn } = stubFetch({ "GET /api/geocode?q=karakoy&lang=en": () => ({ body: { results: [pier, galata, { ...pier, label: "again" }, way] } }) });
    vi.stubGlobal("fetch", fn);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Add a place to Day 1…" }), { target: { value: "karakoy" } });
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Karakoy Kabatas Eminonu Ferries Pier"),
      expect.stringContaining("Galata Kulesi"),
      expect.stringContaining("Karaköy Pier building"),
    ]);
    expect(within(list).getAllByRole("option")[0].textContent).toContain("Karaköy, Beyoğlu");
    expect(errors.mock.calls.flat().join(" ")).not.toContain("same key");
    errors.mockRestore();
  });

  it("offline: says search needs a connection, and the place can still be added by name", async () => {
    newTrip();
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderIntl(<TripScreen tripId="t1" />);
      const box = screen.getByRole("combobox", { name: "Add a place to Day 1…" });
      fireEvent.change(box, { target: { value: "Galata" } });
      expect(await screen.findByText("Search needs a connection — add it by name instead")).toBeTruthy();
      expect(fn).not.toHaveBeenCalled();
      fireEvent.keyDown(box, { key: "Enter" });
      fireEvent.click(screen.getByRole("button", { name: "Add to Day 1" }));
      expect(fake.view.days[0].places[0]).toMatchObject({ name: "Galata", lat: null, osmId: null });
    } finally {
      online.mockRestore();
    }
  });

  it("the new trip's destination comes from search", async () => {
    const { fn, calls } = stubFetch({
      "GET /api/geocode?q=Lisbon&lang=en": () => ({ body: { results: [{ name: "Lisboa", label: "Portugal", lat: 38.7077, lng: -9.1365, osmId: "r5400890", category: "other" }] } }),
      "POST /api/trips": () => ({ status: 201, body: { id: "x".repeat(22) } }),
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<NewTripForm />);
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "Lisbon" } });
    const box = screen.getByRole("combobox", { name: "Destination (optional)" });
    fireEvent.change(box, { target: { value: "Lisbon" } });
    fireEvent.click(await screen.findByRole("option", { name: /Lisboa/ }));
    expect((box as HTMLInputElement).value).toBe("Lisboa");
    fireEvent.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calls.find((c) => c.key === "POST /api/trips")!.body).toMatchObject({ name: "Lisbon", destination: { name: "Lisboa", lat: 38.7077, lng: -9.1365 } });
  });
});

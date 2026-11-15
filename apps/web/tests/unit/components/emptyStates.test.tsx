import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setTripMeta } from "@rota/trip";
import { renderIntl } from "./helpers";
import { fake, newTrip, useFakeTrip } from "./tripHarness";

const searchPlaces = vi.hoisted(() => vi.fn());
vi.mock("@/client/geocode", async (original) => ({ ...(await original<object>()), searchPlaces }));
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
const cafe = { name: "Kronotrop", label: "Cihangir", lat: 41.031, lng: 28.982, osmId: "n1", category: "cafe" };

beforeEach(() => {
  at("");
  // The tips API is not reachable here: no tour over the screen.
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
  searchPlaces.mockReset();
  searchPlaces.mockResolvedValue([cafe]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  at("");
});

function istanbulTrip() {
  const made = newTrip();
  setTripMeta(made.doc, { destination: { name: "Istanbul", lat: 41.01, lng: 28.97 } }, "seed");
  return made;
}

const quick = () => screen.getByRole("group", { name: "Search nearby" });
const search = () => screen.getByRole<HTMLInputElement>("combobox", { name: /^Add a place to/ });

describe("empty states", () => {
  it("an empty day says to add the first stop, with quick searches by category", () => {
    istanbulTrip();
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByText("Add your first stop")).toBeTruthy();
    expect(within(quick()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Food", "Sight", "Café", "Museum"]);
  });

  it("a quick search fills the search with the category word, biased to the trip's area, and opens its results", async () => {
    istanbulTrip();
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(quick()).getByRole("button", { name: "Café" }));
    expect(search().value).toBe("cafe");
    expect(document.activeElement).toBe(search());
    const results = await screen.findByRole("listbox");
    expect(within(results).getByText("Kronotrop")).toBeTruthy();
    // Near the destination, as any search is: the bias, not words in the query.
    expect(searchPlaces).toHaveBeenCalledWith("cafe", "en", { lat: 41.01, lng: 28.97 }, expect.anything());
    // Picking a result goes on as any search does: the add step, asking when.
    fireEvent.click(within(results).getByText("Kronotrop"));
    expect(screen.getByRole("form", { name: /^Add Kronotrop/ })).toBeTruthy();
  });

  it("without a destination too, the category alone; in Turkish, Turkish words", async () => {
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(quick()).getByRole("button", { name: "Museum" }));
    expect(search().value).toBe("museum");
    cleanup();

    istanbulTrip();
    renderIntl(<TripScreen tripId="t1" />, "tr");
    fireEvent.click(within(screen.getByRole("group", { name: "Yakında ara" })).getByRole("button", { name: "Yemek" }));
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("restoran"));
  });

  it("quick searches are touch-sized on phones (44 px, below the 1024 px layout break)", () => {
    istanbulTrip();
    renderIntl(<TripScreen tripId="t1" />);
    for (const button of within(quick()).getAllByRole("button")) expect(button.className.split(" ")).toEqual(expect.arrayContaining(["h-8", "max-lg:h-11"]));
  });

  it("without edit access, an empty day has no quick searches", () => {
    istanbulTrip();
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.queryByRole("group", { name: "Search nearby" })).toBeNull();
    expect(screen.getByText("Nothing planned yet. Add a place, or drag one here.")).toBeTruthy();
  });

  it("the whole trip offers quick searches only for the day its search adds to", () => {
    istanbulTrip();
    at("?view=all");
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getAllByRole("group", { name: "Search nearby" })).toHaveLength(1);
    expect(screen.getAllByText("Add your first stop")).toHaveLength(1);
    expect(screen.getByText("Nothing planned yet. Add a place, or drag one here.")).toBeTruthy();
  });

  it("empty Ideas explain suggestions and votes; an empty checklist says what it is for", () => {
    istanbulTrip();
    at("?view=ideas");
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByText("No ideas yet. Keep places you might visit here, or suggest one so everyone can vote on it.")).toBeTruthy();
    cleanup();

    at("?view=checklist");
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByText("Add things to pack or book")).toBeTruthy();
  });

  it("read-only, empty Ideas do not ask to suggest", () => {
    istanbulTrip();
    fake.userId = null;
    at("?view=ideas");
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByText("No ideas yet. Places you might visit show up here.")).toBeTruthy();
    expect(screen.queryByText(/suggest one/)).toBeNull();
  });
});

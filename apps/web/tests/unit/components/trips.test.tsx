import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { renderIntl, stubFetch } from "./helpers";

const replace = vi.fn();
const userState = vi.hoisted(() => ({ value: { userId: "u1" as string | null, signedOut: false } }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/client/authClient", () => ({
  useUserState: () => userState.value,
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));

import { MyTrips } from "@/components/trips/MyTrips";
import { TripSettingsScreen } from "@/components/trip/TripSettingsScreen";
import { cacheTrips, markOfflineCopy, type CachedTrip } from "@/client/myTrips";

const trip = (id: string, name: string, startDate: string): CachedTrip => ({
  id,
  name,
  startDate,
  days: 3,
  destination: null,
  isDemo: false,
  role: "owner",
  members: [
    { id: "u1", name: "Ann", colour: "#2563eb" },
    { id: "u2", name: "Deniz", colour: "#ea580c" },
  ],
});

const old = trip("a".repeat(22), "Old Rome", "2001-05-01");
const soon = trip("b".repeat(22), "Future Lisbon", "2099-05-01");

beforeEach(() => {
  localStorage.clear();
  userState.value = { userId: "u1", signedOut: false };
  replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("my trips", () => {
  it("shows upcoming before past and an offline badge for trips with a copy", async () => {
    markOfflineCopy(soon.id, "u1");
    vi.stubGlobal("fetch", stubFetch({ "GET /api/trips": () => ({ body: [old, soon] }) }).fn);
    renderIntl(<MyTrips />);
    await screen.findByText("Future Lisbon");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Upcoming", "Past"]);
    const cards = screen.getAllByRole("listitem");
    expect(cards.map((c) => within(c).getByRole("link").textContent)).toEqual([expect.stringContaining("Future Lisbon"), expect.stringContaining("Old Rome")]);
    expect(within(cards[0]).getByText("Offline copy")).toBeTruthy();
    expect(within(cards[1]).queryByText("Offline copy")).toBeNull();
    expect(within(cards[0]).getByRole("img", { name: "Deniz" })).toBeTruthy();
    expect(screen.queryByText(/You are offline/)).toBeNull();
  });

  it("offline, shows the trips cached on the device with a notice", async () => {
    cacheTrips("u1", [soon]);
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    renderIntl(<MyTrips />);
    expect(await screen.findByText("Future Lisbon")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("You are offline");
  });

  it("signed out (no session, nobody remembered) goes to sign in instead of loading forever", async () => {
    userState.value = { userId: null, signedOut: true };
    renderIntl(<MyTrips />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Ftrips"));
  });

  it("trip settings signed out goes to sign in, coming back to the settings", async () => {
    userState.value = { userId: null, signedOut: true };
    renderIntl(<TripSettingsScreen tripId={"c".repeat(22)} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/sign-in?next=%2Ftrips%2F${"c".repeat(22)}%2Fsettings`));
  });

  it("a settled session with a remembered user (offline) does not redirect", async () => {
    cacheTrips("u1", [soon]);
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    renderIntl(<MyTrips />);
    await screen.findByText("Future Lisbon");
    expect(replace).not.toHaveBeenCalled();
  });
});

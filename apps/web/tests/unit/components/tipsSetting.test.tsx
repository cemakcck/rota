import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderIntl, stubFetch } from "./helpers";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/client/authClient", () => ({ apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a) }));
vi.mock("@/client/myTrips", () => ({ forgetTrip: vi.fn() }));

import { TripSettings } from "@/components/trip/TripSettings";

const TRIP = "t".repeat(22);
const trip = { id: TRIP, name: "Lisbon", startDate: "2027-05-01", days: 3 };
const ann = { id: "u1", name: "Ann", colour: "#2563eb", role: "owner" as const };
const deniz = { id: "u2", name: "Deniz", colour: "#ea580c", role: "member" as const };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("show tips again", () => {
  it("is in every member's settings, and forgets the tour on the server and this device", async () => {
    const { fn, calls } = stubFetch({ "DELETE /api/profile/tips": () => ({ status: 204 }) });
    vi.stubGlobal("fetch", fn);
    localStorage.setItem("rota.tipsSeen.u2", "seen");
    renderIntl(<TripSettings trip={trip} members={[ann, deniz]} userId="u2" locale="en" onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Show tips again" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Tips will show the next time you open a trip.");
    expect(calls.map((c) => c.key)).toEqual(["DELETE /api/profile/tips"]);
    expect(localStorage.getItem("rota.tipsSeen.u2")).toBeNull();
  });

  it("says so when offline, and keeps what this device knows", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    localStorage.setItem("rota.tipsSeen.u1", "seen");
    renderIntl(<TripSettings trip={trip} members={[ann]} userId="u1" locale="en" onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Show tips again" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/offline/i);
    expect(localStorage.getItem("rota.tipsSeen.u1")).toBe("seen");
  });
});

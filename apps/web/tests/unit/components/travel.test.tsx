import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { addPlace } from "@rota/trip";
import { renderIntl, stubFetch } from "./helpers";
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const day1 = () => screen.getByRole("region", { name: /^Day 1\b/ });

function twoStops(lng: number) {
  const { doc, dayIds } = newTrip({ days: 1 });
  addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], lat: 41.0256, lng }, "u1");
  addPlace(doc, { name: "Pera Museum", category: "museum", dayId: dayIds[0], lat: 41.0317, lng: lng + 0.001 }, "u1");
  return `${lng},41.0256;${lng + 0.001},41.0317`;
}

describe("travel times", () => {
  it("road legs show the routed time and distance, and the day total", async () => {
    const coords = twoStops(28.9742);
    const { fn } = stubFetch({
      [`GET /api/route?mode=walk&coords=${coords}`]: () => ({
        body: { legs: [{ seconds: 720, meters: 950 }], geometry: { type: "LineString", coordinates: [[28.9742, 41.0256], [28.9752, 41.0317]] } },
      }),
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);
    expect(await within(day1()).findByText("12 min walk · 950 m")).toBeTruthy();
    expect(within(day1()).queryByText(/≈/)).toBeNull();
    expect(within(day1()).getByText("12 min travel")).toBeTruthy();
    // The second stop's arrival follows the routed leg: 09:00, a 45 min stay, then 12 min.
    expect(within(day1()).getByText("around 09:57")).toBeTruthy();
  });

  it("approximate legs show ≈", async () => {
    const coords = twoStops(28.9642);
    const { fn, calls } = stubFetch({ [`GET /api/route?mode=walk&coords=${coords}`]: () => ({ status: 503, body: { error: "upstream_unavailable" } }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);
    await waitFor(() => expect(calls.some((c) => c.key.startsWith("GET /api/route"))).toBe(true));
    const leg = within(day1()).getByTestId("travel-leg");
    expect(leg.textContent).toMatch(/^≈/);
    // "≈" is decoration; screen readers hear "estimated".
    expect(within(leg).getByText("≈").getAttribute("aria-hidden")).toBe("true");
    expect(within(leg).getByText("estimated", { exact: false }).className).toContain("sr-only");
    expect(within(day1()).getByTestId("travel-total").textContent).toMatch(/^≈ estimated, .* travel$/);
  });
});

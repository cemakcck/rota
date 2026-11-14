import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
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

// The whole trip in the list column: these cover every day and Ideas at once.
beforeEach(() => window.history.replaceState(null, "", "/en/t/t1?view=all"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const day1 = () => screen.getByRole("region", { name: /^Day 1\b/ });

function twoStops(lng: number) {
  const { doc, dayIds } = newTrip({ days: 1 });
  addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], lat: 41.0256, lng, time: "09:00" }, "u1");
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
    // The second stop's estimated arrival follows the routed leg: set at 09:00, a 45 min stay, then 12 min.
    expect(within(day1()).getByText("around 09:57")).toBeTruthy();
  });

  it("a trip with five routed days gets road legs for every day, one request at a time", async () => {
    const { doc, dayIds } = newTrip({ days: 5 });
    dayIds.forEach((dayId, i) => {
      addPlace(doc, { name: `Start ${i + 1}`, category: "sight", dayId, lat: 40.5, lng: 27 + i / 10 }, "u1");
      addPlace(doc, { name: `End ${i + 1}`, category: "sight", dayId, lat: 40.51, lng: 27 + i / 10 }, "u1");
    });
    // Like the server's throttle under a burst: a request while another is in flight gets a 503.
    let inFlight = 0;
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.startsWith("/api/route")) return new Response(null, { status: 503 });
      if (inFlight > 0) return new Response(JSON.stringify({ error: "upstream_unavailable" }), { status: 503 });
      inFlight++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return new Response(JSON.stringify({ legs: [{ seconds: 300, meters: 400 }], geometry: { type: "LineString", coordinates: [] } }));
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);
    // Five requests one after another, each re-rendering a five-day screen: slow on a busy machine.
    await waitFor(() => expect(screen.getAllByText("5 min walk · 400 m")).toHaveLength(5), { timeout: 5000 });
    expect(screen.queryAllByTestId("travel-leg").filter((l) => l.textContent?.startsWith("≈"))).toHaveLength(0);
    // Each day asked once: none turned away.
    expect(fn.mock.calls.filter(([url]) => String(url).startsWith("/api/route"))).toHaveLength(5);
  });

  it("routes that could not be asked for offline are asked for when the connection returns", async () => {
    const coords = twoStops(28.9542);
    const { fn, calls } = stubFetch({
      [`GET /api/route?mode=walk&coords=${coords}`]: () => ({ body: { legs: [{ seconds: 840, meters: 1100 }], geometry: { type: "LineString", coordinates: [] } } }),
    });
    vi.stubGlobal("fetch", fn);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderIntl(<TripScreen tripId="t1" />);
      expect(within(day1()).getByTestId("travel-leg").textContent).toMatch(/^≈/);
      expect(calls).toHaveLength(0);
      online.mockReturnValue(true);
      act(() => void window.dispatchEvent(new Event("online")));
      expect(await within(day1()).findByText("14 min walk · 1.1 km")).toBeTruthy();
    } finally {
      online.mockRestore();
    }
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

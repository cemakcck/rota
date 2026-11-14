import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
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
import { HoursWarning } from "@/components/trip/HoursWarning";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The harness trip, moved to start on Monday 30 Nov 2026. */
function mondayTrip() {
  const { doc, dayIds } = newTrip({ days: 1 });
  doc.getMap("meta").set("startDate", "2026-11-30");
  return { doc, dayIds };
}

describe("opening hours", () => {
  it("an opening-hours warning appears for a Monday museum visit", async () => {
    const { doc, dayIds } = mondayTrip();
    addPlace(doc, { name: "Pera Museum", category: "museum", dayId: dayIds[0], osmId: "n101" }, "u1");
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], osmId: "w102" }, "u1");
    vi.stubGlobal(
      "fetch",
      stubFetch({ "GET /api/hours?ids=n101,w102": () => ({ body: { hours: { n101: "Tu-Su 10:00-19:00", w102: "Mo-Su 08:30-23:00" } } }) }).fn,
    );
    renderIntl(<TripScreen tripId="t1" />);
    const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
    const note = await within(row("Pera Museum")).findByRole("note");
    expect(note.textContent).toBe("Closed on Mondays");
    expect(within(row("Galata Tower")).queryByRole("note")).toBeNull();
  });

  it("formats every kind of warning in both languages", () => {
    const { unmount } = renderIntl(
      <>
        <HoursWarning warning={{ kind: "closed-day" }} date="2026-11-30" arrive="09:00" />
        <HoursWarning warning={{ kind: "opens-later", at: "10:00" }} date="2026-11-30" arrive="09:30" />
        <HoursWarning warning={{ kind: "closes-before", at: "17:00" }} date="2026-11-30" arrive="16:50" />
      </>,
    );
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toEqual([
      "Closed on Mondays",
      "Opens at 10:00 — you arrive around 09:30",
      "Closes at 17:00 — you arrive around 16:50",
    ]);
    unmount();
    renderIntl(<HoursWarning warning={{ kind: "closed-day" }} date="2026-11-30" arrive="09:00" />, "tr");
    expect(screen.getByRole("note").textContent).toBe("Pazartesi günleri kapalı");
  });

  it("no data, no warning", async () => {
    const { doc, dayIds } = mondayTrip();
    addPlace(doc, { name: "Unknown Bar", category: "drinks", dayId: dayIds[0], osmId: "n103" }, "u1");
    const { fn, calls } = stubFetch({ "GET /api/hours?ids=n103": () => ({ body: { hours: { n103: null } } }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole("note")).toBeNull();
  });
});

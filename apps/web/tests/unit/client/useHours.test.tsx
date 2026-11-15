import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { addPlace, initTrip, readTrip, type Leg } from "@rota/trip";
import { stubFetch } from "../components/helpers";

const parsed = vi.hoisted(() => ({ count: 0 }));
vi.mock("@rota/trip", async (original) => {
  const real = await original<typeof import("@rota/trip")>();
  return {
    ...real,
    openingTimes: (...args: Parameters<typeof real.openingTimes>) => {
      parsed.count++;
      return real.openingTimes(...args);
    },
  };
});
vi.mock("@/client/authClient", () => ({ apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a) }));

import { useHours } from "@/client/useHours";

afterEach(() => vi.unstubAllGlobals());

describe("useHours", () => {
  it("parses opening hours again only when the trip, the legs or the fetched hours change", async () => {
    vi.stubGlobal("fetch", stubFetch({ "GET /api/hours?ids=n901": () => ({ body: { hours: { n901: "Mo-Su 10:00-19:00" } } }) }).fn);
    const doc = new Y.Doc();
    initTrip(doc, { name: "T", startDate: "2026-11-30", days: 1, locale: "en" }, "u1");
    const dayId = readTrip(doc).days[0].id;
    addPlace(doc, { name: "Museum", category: "museum", dayId, osmId: "n901", time: "09:00" }, "u1");
    const view = readTrip(doc);
    const noLegs = (): (Leg | null)[] => [];
    const { result, rerender } = renderHook((p: { legs: typeof noLegs }) => useHours(view, p.legs, "en"), { initialProps: { legs: noLegs } });
    await waitFor(() => expect(result.current.open.size).toBe(1));
    const after = parsed.count;
    // Re-renders with the same trip, legs and hours: nothing parsed again, the same maps.
    const before = result.current;
    rerender({ legs: noLegs });
    rerender({ legs: noLegs });
    expect(parsed.count).toBe(after);
    expect(result.current.open).toBe(before.open);
    // New legs: worked out again.
    rerender({ legs: () => [] });
    expect(parsed.count).toBeGreaterThan(after);
  });
});

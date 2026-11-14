import { describe, expect, it } from "vitest";
import { dayUrls, placeUrl, type DayView, type PlaceView } from "../src";

const pl = (i: number, coords = true) =>
  ({ id: `p${i}`, name: "Çiya Sofrası", lat: coords ? 41 + i / 100 : null, lng: coords ? 29 : null }) as PlaceView;
const day = (n: number, travelMode: "walk" | "drive" = "walk") =>
  ({ travelMode, places: Array.from({ length: n }, (_, i) => pl(i)) }) as DayView;
const waypoints = (u: string) => (new URL(u).searchParams.get("waypoints") ?? "").split("|").filter(Boolean);

describe("gmaps", () => {
  it("placeUrl uses coordinates, else the encoded name", () => {
    expect(placeUrl(pl(0))).toBe("https://www.google.com/maps/search/?api=1&query=41,29");
    expect(placeUrl(pl(0, false))).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Çiya Sofrası")}`,
    );
  });
  it("a 12-stop day splits into two links sharing the boundary stop, each with ≤ 9 waypoints", () => {
    const urls = dayUrls(day(12), "walk");
    expect(urls).toHaveLength(2);
    for (const u of urls) expect(waypoints(u).length).toBeLessThanOrEqual(9);
    const [u1, u2] = urls.map((u) => new URL(u).searchParams);
    expect(u1.get("destination")).toBe(u2.get("origin"));
    expect(u1.get("origin")).toBe("41,29");
    expect(u2.get("destination")).toBe("41.11,29");
  });
  it("travelmode follows the day's mode", () => {
    expect(dayUrls(day(3), "walk")[0]).toContain("travelmode=walking");
    expect(dayUrls(day(3), "drive")[0]).toContain("travelmode=driving");
  });
  it("one stop gives a place URL, none gives nothing", () => {
    expect(dayUrls(day(0), "walk")).toEqual([]);
    expect(dayUrls(day(1), "walk")).toEqual([placeUrl(pl(0))]);
  });
});

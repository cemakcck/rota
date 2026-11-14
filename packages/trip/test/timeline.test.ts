import { describe, expect, it } from "vitest";
import { dayTimeline, type DayView, type PlaceView } from "../src";

const p = (id: string, stayMinutes: number) => ({ id, stayMinutes }) as PlaceView;
const day = (startTime: string, places: PlaceView[]) => ({ startTime, places }) as DayView;
const leg = (minutes: number) => ({ seconds: minutes * 60, meters: 1000, approximate: true });

describe("dayTimeline", () => {
  it("arrivals add stays and legs", () => {
    const t = dayTimeline(day("09:00", [p("a", 120), p("b", 60)]), [leg(15)]);
    expect(t[0]).toEqual({ placeId: "a", arrive: "09:00", leave: "11:00", overflowDays: 0 });
    expect(t[1]).toEqual({ placeId: "b", arrive: "11:15", leave: "12:15", overflowDays: 0 });
  });
  it("a null leg counts as zero", () => {
    const t = dayTimeline(day("09:00", [p("a", 60), p("b", 60)]), [null]);
    expect(t[1].arrive).toBe("10:00");
  });
  it("a day running past midnight reports overflowDays", () => {
    const t = dayTimeline(day("22:00", [p("a", 120), p("b", 60), p("c", 1500)]), [leg(30), null]);
    expect(t[0]).toMatchObject({ arrive: "22:00", leave: "00:00", overflowDays: 1 });
    expect(t[1]).toMatchObject({ arrive: "00:30", overflowDays: 1 });
    expect(t[2]).toMatchObject({ arrive: "01:30", leave: "02:30", overflowDays: 2 });
  });
});

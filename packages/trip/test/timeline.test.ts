import { describe, expect, it } from "vitest";
import { dayTimeline, suggestTime, type DayView, type PlaceView } from "../src";

const p = (id: string, stayMinutes: number, time: string | null = null) => ({ id, stayMinutes, time }) as PlaceView;
const day = (places: PlaceView[]) => ({ places }) as DayView;
const leg = (minutes: number) => ({ seconds: minutes * 60, meters: 1000, approximate: true });

describe("dayTimeline", () => {
  it("a set time shows as arrive, not estimated", () => {
    const t = dayTimeline(day([p("a", 120, "07:00")]), []);
    expect(t[0]).toEqual({ placeId: "a", arrive: "07:00", leave: "09:00", estimated: false, lateBy: null, overflowDays: 0 });
  });

  it("untimed stops after a timed one get estimated times including travel", () => {
    const t = dayTimeline(day([p("a", 120, "09:00"), p("b", 60), p("c", 30)]), [leg(15), null]);
    expect(t[1]).toEqual({ placeId: "b", arrive: "11:15", leave: "12:15", estimated: true, lateBy: null, overflowDays: 0 });
    // A null leg counts as zero.
    expect(t[2]).toMatchObject({ arrive: "12:15", leave: "12:45", estimated: true });
  });

  it("untimed stops before any timed stop have no time", () => {
    const t = dayTimeline(day([p("a", 60), p("b", 60), p("c", 60, "13:00"), p("d", 30)]), [leg(10), leg(10), leg(5)]);
    expect(t[0]).toEqual({ placeId: "a", arrive: null, leave: null, estimated: false, lateBy: null, overflowDays: 0 });
    expect(t[1]).toMatchObject({ arrive: null, leave: null, estimated: false });
    expect(t[2]).toMatchObject({ arrive: "13:00", leave: "14:00", estimated: false, lateBy: null });
    expect(t[3]).toMatchObject({ arrive: "14:05", estimated: true });
  });

  it("a set time earlier than reachable reports lateBy", () => {
    // a ends 10:00, plus 25 min travel: reachable 10:25, set 10:05.
    const t = dayTimeline(day([p("a", 60, "09:00"), p("b", 60, "10:05"), p("c", 30, "12:00")]), [leg(25), leg(10)]);
    expect(t[1]).toMatchObject({ arrive: "10:05", leave: "11:05", estimated: false, lateBy: 20 });
    // The next stop counts from the set time, not the late one.
    expect(t[2]).toMatchObject({ arrive: "12:00", lateBy: null });
    // Exactly reachable is not late.
    expect(dayTimeline(day([p("a", 60, "09:00"), p("b", 60, "10:25")]), [leg(25)])[1].lateBy).toBeNull();
  });

  it("a day running past midnight reports overflowDays", () => {
    const t = dayTimeline(day([p("a", 120, "22:00"), p("b", 60), p("c", 1500)]), [leg(30), null]);
    expect(t[0]).toMatchObject({ arrive: "22:00", leave: "00:00", overflowDays: 1 });
    expect(t[1]).toMatchObject({ arrive: "00:30", overflowDays: 1, estimated: true });
    expect(t[2]).toMatchObject({ arrive: "01:30", leave: "02:30", overflowDays: 2 });
  });
});

describe("suggestTime", () => {
  it("suggestTime is previous end plus travel, null with nothing timed before", () => {
    const d = day([p("a", 60), p("b", 90, "09:00"), p("c", 45)]);
    const legs = [leg(10), leg(15), leg(20)];
    expect(suggestTime(d, legs, 0)).toBeNull();
    expect(suggestTime(d, legs, 1)).toBeNull(); // only an untimed stop before
    // b 09:00 + 90 min stay + 15 min travel to the slot.
    expect(suggestTime(d, legs, 2)).toBe("10:45");
    // Appending: c (est. 10:45) + 45 min + leg 2 (to the new stop) 20 min.
    expect(suggestTime(d, legs, 3)).toBe("11:50");
    // No leg known for the slot: counted as zero.
    expect(suggestTime(d, [leg(10), leg(15)], 3)).toBe("11:30");
    expect(suggestTime(day([]), [], 0)).toBeNull();
  });

  it("suggestTime is null when the suggestion would pass midnight (no wrap)", () => {
    expect(suggestTime(day([p("a", 90, "22:00")]), [leg(30)], 1)).toBeNull(); // 24:00
    expect(suggestTime(day([p("a", 90, "22:00")]), [leg(29)], 1)).toBe("23:59");
    expect(suggestTime(day([p("a", 600, "20:00"), p("b", 30)]), [leg(10)], 2)).toBeNull();
  });
});

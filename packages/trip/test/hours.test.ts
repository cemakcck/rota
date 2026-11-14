import { describe, expect, it } from "vitest";
import { closedAllDay, hoursWarning } from "../src";

// 2026-11-16 is a Monday.
describe("hoursWarning", () => {
  it('"Tu-Su 09:00-17:00" on a Monday → closed-day', () => {
    expect(hoursWarning("Tu-Su 09:00-17:00", "2026-11-16", "10:00", "11:00", "en")?.kind).toBe("closed-day");
  });
  it("arrive 09:30 at Mo-Su 10:00-18:00 → opens-later at 10:00", () => {
    expect(hoursWarning("Mo-Su 10:00-18:00", "2026-11-16", "09:30", "11:00", "en")).toEqual({
      kind: "opens-later",
      at: "10:00",
    });
  });
  it("leave 17:10 at Mo-Su 09:00-17:00 → closes-before at 17:00", () => {
    expect(hoursWarning("Mo-Su 09:00-17:00", "2026-11-16", "16:00", "17:10", "tr")).toEqual({
      kind: "closes-before",
      at: "17:00",
    });
  });
  it("closedAllDay needs only the date: true only when the place does not open that day", () => {
    expect(closedAllDay("Tu-Su 09:00-17:00", "2026-11-16")).toBe(true);
    expect(closedAllDay("Tu-Su 09:00-17:00", "2026-11-17")).toBe(false);
    expect(closedAllDay("Mo-Su 10:00-18:00", "2026-11-16")).toBe(false);
    expect(closedAllDay("24/7", "2026-11-16")).toBe(false);
    expect(closedAllDay("not hours at all", "2026-11-16")).toBe(false);
    expect(closedAllDay("Tu-Su 09:00-17:00", "")).toBe(false);
  });
  it("fits inside opening hours → null", () => {
    expect(hoursWarning("Mo-Su 09:00-17:00", "2026-11-16", "10:00", "11:00", "en")).toBeNull();
  });
  it('"24/7" → null', () => {
    expect(hoursWarning("24/7", "2026-11-16", "10:00", "23:00", "en")).toBeNull();
  });
  it("garbage → null", () => {
    expect(hoursWarning("not hours at all", "2026-11-16", "10:00", "11:00", "en")).toBeNull();
  });
  it("result is the same under TZ=America/New_York", () => {
    expect(hoursWarning("Mo-Su 10:00-18:00", "2026-11-16", "09:30", "11:00", "en")).toEqual({
      kind: "opens-later",
      at: "10:00",
    });
    expect(process.env.TZ).toBe("America/New_York");
  });
  it("arriving after today's last closing → closes-before, not tomorrow's opening", () => {
    expect(hoursWarning("Mo-Su 09:00-17:00", "2026-11-16", "18:00", "19:00", "en")).toEqual({
      kind: "closes-before",
      at: "17:00",
    });
  });
  it("an unknown interval only tomorrow does not suppress today's warning", () => {
    expect(hoursWarning('Mo 09:00-17:00; Tu "by appointment"', "2026-11-16", "16:00", "17:30", "en")).toEqual({
      kind: "closes-before",
      at: "17:00",
    });
  });
  it("an interval crossing midnight from today still counts as open", () => {
    expect(hoursWarning("Mo-Su 18:00-02:00", "2026-11-16", "23:00", "23:50", "en")).toBeNull();
    expect(hoursWarning("Mo-Su 18:00-02:00", "2026-11-16", "23:00", "03:00", "en")).toEqual({
      kind: "closes-before",
      at: "02:00",
    });
  });
});

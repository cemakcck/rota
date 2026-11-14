import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addPlace, createUndo, initTrip, readTrip, shiftDayTimes, type DayView } from "../src";
import { replica, sync } from "./helpers";

function trip(): { doc: Y.Doc; dayId: string; other: string } {
  const doc = new Y.Doc();
  initTrip(doc, { name: "Istanbul", startDate: "2026-11-30", days: 2, locale: "en" }, "alice");
  const [day, other] = readTrip(doc).days;
  return { doc, dayId: day.id, other: other.id };
}

const day0 = (doc: Y.Doc) => readTrip(doc).days[0];
const times = (day: DayView) => day.places.map((p) => `${p.name}:${p.time ?? "-"}`);

describe("shiftDayTimes", () => {
  it("moves every set time of the day; untimed stops and other days are untouched", () => {
    const { doc, dayId, other } = trip();
    addPlace(doc, { name: "A", category: "sight", dayId, time: "09:00" }, "alice");
    addPlace(doc, { name: "u", category: "sight", dayId }, "alice");
    addPlace(doc, { name: "B", category: "sight", dayId, time: "13:45" }, "alice");
    addPlace(doc, { name: "C", category: "sight", dayId: other, time: "10:00" }, "alice");
    expect(shiftDayTimes(doc, dayId, 30, "alice")).toEqual({ clamped: [] });
    expect(times(day0(doc))).toEqual(["A:09:30", "u:-", "B:14:15"]);
    expect(readTrip(doc).days[1].places[0].time).toBe("10:00");
    shiftDayTimes(doc, dayId, -60, "alice");
    expect(times(day0(doc))).toEqual(["A:08:30", "u:-", "B:13:15"]);
  });

  it("clamps at 00:00 and 23:59 and reports the clamped stops", () => {
    const { doc, dayId } = trip();
    const early = addPlace(doc, { name: "Early", category: "sight", dayId, time: "00:10" }, "alice");
    addPlace(doc, { name: "Mid", category: "sight", dayId, time: "12:00" }, "alice");
    const late = addPlace(doc, { name: "Late", category: "sight", dayId, time: "23:40" }, "alice");
    expect(shiftDayTimes(doc, dayId, -15, "alice")).toEqual({ clamped: [early] });
    expect(times(day0(doc))).toEqual(["Early:00:00", "Mid:11:45", "Late:23:25"]);
    expect(shiftDayTimes(doc, dayId, 60, "alice")).toEqual({ clamped: [late] });
    expect(times(day0(doc))).toEqual(["Early:01:00", "Mid:12:45", "Late:23:59"]);
  });

  it("is one undo step, reverting only its author's change", () => {
    const { doc, dayId } = trip();
    addPlace(doc, { name: "A", category: "sight", dayId, time: "09:00" }, "alice");
    addPlace(doc, { name: "B", category: "sight", dayId, time: "11:00" }, "alice");
    const undo = createUndo(doc, "alice");
    undo.stopCapturing();
    shiftDayTimes(doc, dayId, 15, "alice");
    // A friend edits meanwhile.
    const bob = replica(doc);
    addPlace(bob, { name: "Bob's", category: "food", dayId, time: "18:00" }, "bob");
    sync(doc, bob);
    undo.undo();
    expect(times(day0(doc))).toEqual(["A:09:00", "B:11:00", "Bob's:18:00"]);
    expect(undo.canUndo()).toBe(false);
  });

  it("keeps the timed stops in chronological order after clamping", () => {
    const { doc, dayId } = trip();
    addPlace(doc, { name: "X", category: "sight", dayId, time: "23:00" }, "alice");
    addPlace(doc, { name: "Y", category: "sight", dayId, time: "23:30" }, "alice");
    shiftDayTimes(doc, dayId, 60, "alice");
    expect(times(day0(doc))).toEqual(["X:23:59", "Y:23:59"]);
    // A timed stop out of order (written concurrently) is put back in order by the shift.
    const d = day0(doc);
    const places = doc.getMap<Y.Map<unknown>>("places");
    places.get(d.places[0].id)!.set("time", "08:00");
    places.get(d.places[1].id)!.set("time", "07:00");
    shiftDayTimes(doc, dayId, 15, "alice");
    expect(times(day0(doc))).toEqual(["Y:07:15", "X:08:15"]);
  });

  it("does nothing for an unknown day, zero minutes or a day without set times", () => {
    const { doc, dayId } = trip();
    addPlace(doc, { name: "u", category: "sight", dayId }, "alice");
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    expect(shiftDayTimes(doc, "nope", 30, "alice")).toEqual({ clamped: [] });
    expect(shiftDayTimes(doc, dayId, 0, "alice")).toEqual({ clamped: [] });
    expect(shiftDayTimes(doc, dayId, 30, "alice")).toEqual({ clamped: [] });
    expect(transactions).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addPlace, createUndo, initTrip, readTrip, setPlaceTime, shiftDayTimes, type DayView } from "../src";
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

  it("writes nothing (no undo step) when every set time is already at the limit, but still reports them", () => {
    const { doc, dayId } = trip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId, time: "23:59" }, "alice");
    const b = addPlace(doc, { name: "B", category: "sight", dayId, time: "23:59" }, "alice");
    const undo = createUndo(doc, "alice");
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    expect(shiftDayTimes(doc, dayId, 30, "alice")).toEqual({ clamped: [a, b] });
    expect(transactions).toBe(0);
    expect(undo.canUndo()).toBe(false);
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

  // Which concurrent write of a key wins depends on the writers' client ids (the higher one), so both
  // outcomes are pinned.
  for (const winner of ["bob", "alice"] as const) {
    it(`merged with a friend's diverged edits (${winner}'s write wins): nothing is lost, readTrip still reads it`, () => {
      const { doc: alice, dayId } = trip();
      addPlace(alice, { name: "A", category: "sight", dayId, time: "09:00" }, "alice");
      const b = addPlace(alice, { name: "B", category: "sight", dayId, time: "11:00" }, "alice");
      addPlace(alice, { name: "C", category: "sight", dayId, time: "14:00" }, "alice");
      const bob = replica(alice);
      bob.clientID = winner === "bob" ? alice.clientID + 1 : alice.clientID - 1;
      // Offline at the same time: Alice shifts the day an hour later; Bob adds a stop and re-times B.
      shiftDayTimes(alice, dayId, 60, "alice");
      addPlace(bob, { name: "D", category: "food", dayId, time: "10:30" }, "bob");
      setPlaceTime(bob, b, "08:00", "bob");
      sync(alice, bob);

      for (const doc of [alice, bob]) expect(() => readTrip(doc)).not.toThrow();
      expect(day0(bob)).toEqual(day0(alice));
      expect(day0(alice).places.map((p) => p.name).sort()).toEqual(["A", "B", "C", "D"]);
      // Times are absolute (last write wins): B has Alice's shifted time or Bob's, never both; D, added
      // by Bob meanwhile, was not shifted.
      if (winner === "bob") expect(times(day0(alice))).toEqual(["B:08:00", "A:10:00", "D:10:30", "C:15:00"]);
      // Current behaviour, pinned: the merge is not re-sorted, so B (12:00) stays where Bob put it, out of
      // chronological order until the next local time edit or shift re-sorts the day.
      else expect(times(day0(alice))).toEqual(["B:12:00", "A:10:00", "D:10:30", "C:15:00"]);
    });
  }
});

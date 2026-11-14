import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addPlace, createUndo, initTrip, migrateDayStart, movePlace, readTrip, setPlaceTime, dayTimeline, type DayView } from "../src";

function trip(days = 1): { doc: Y.Doc; dayId: string } {
  const doc = new Y.Doc();
  initTrip(doc, { name: "Istanbul", startDate: "2026-11-30", days, locale: "en" }, "alice");
  return { doc, dayId: readTrip(doc).days[0].id };
}

const names = (day: DayView) => day.places.map((p) => p.name);
const day0 = (doc: Y.Doc) => readTrip(doc).days[0];

describe("times set per stop", () => {
  it("places are untimed unless given a time, and new days have no start time", () => {
    const { doc, dayId } = trip();
    addPlace(doc, { name: "A", category: "sight", dayId }, "alice");
    addPlace(doc, { name: "B", category: "sight", dayId, time: "07:15" }, "alice");
    expect(day0(doc).places.map((p) => p.time)).toEqual([null, "07:15"]);
    expect(doc.getMap<Y.Map<unknown>>("days").get(dayId)!.has("startTime")).toBe(false);
    expect("startTime" in day0(doc)).toBe(false);
  });

  it("addPlace puts a timed stop in chronological order", () => {
    const { doc, dayId } = trip();
    addPlace(doc, { name: "Lunch", category: "food", dayId, time: "13:00" }, "alice");
    addPlace(doc, { name: "Breakfast", category: "food", dayId, time: "08:30" }, "alice");
    addPlace(doc, { name: "Walk", category: "sight", dayId }, "alice");
    addPlace(doc, { name: "Museum", category: "museum", dayId, time: "10:15" }, "alice");
    addPlace(doc, { name: "Dinner", category: "food", dayId, time: "19:00" }, "alice");
    expect(names(day0(doc))).toEqual(["Breakfast", "Museum", "Lunch", "Walk", "Dinner"]);
    expect(() => addPlace(doc, { name: "Bad", category: "food", dayId, time: "25:00" }, "alice")).toThrow();
  });

  it("setting a time moves the stop into chronological order", () => {
    const { doc, dayId } = trip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId, time: "09:00" }, "alice");
    addPlace(doc, { name: "B", category: "sight", dayId, time: "11:00" }, "alice");
    addPlace(doc, { name: "C", category: "sight", dayId, time: "15:00" }, "alice");
    expect(setPlaceTime(doc, a, "12:30", "alice")).toBe(true);
    expect(names(day0(doc))).toEqual(["B", "A", "C"]);
    expect(day0(doc).places[1].time).toBe("12:30");
    setPlaceTime(doc, a, "07:00", "alice");
    expect(names(day0(doc))).toEqual(["A", "B", "C"]);
    setPlaceTime(doc, a, "18:00", "alice");
    expect(names(day0(doc))).toEqual(["B", "C", "A"]);
    // Clearing a time leaves the stop where it is.
    setPlaceTime(doc, a, null, "alice");
    expect(names(day0(doc))).toEqual(["B", "C", "A"]);
    expect(day0(doc).places[2].time).toBeNull();
  });

  it("untimed stops keep their position between timed neighbours", () => {
    const { doc, dayId } = trip();
    addPlace(doc, { name: "u0", category: "sight", dayId }, "alice");
    addPlace(doc, { name: "T9", category: "sight", dayId, time: "09:00" }, "alice");
    addPlace(doc, { name: "u1", category: "sight", dayId }, "alice");
    const x = addPlace(doc, { name: "X", category: "sight", dayId }, "alice");
    addPlace(doc, { name: "u2", category: "sight", dayId }, "alice");
    addPlace(doc, { name: "T14", category: "sight", dayId, time: "14:00" }, "alice");
    addPlace(doc, { name: "u3", category: "sight", dayId }, "alice");
    expect(names(day0(doc))).toEqual(["u0", "T9", "u1", "X", "u2", "T14", "u3"]);

    // Already between its timed neighbours: nothing moves.
    setPlaceTime(doc, x, "11:00", "alice");
    expect(names(day0(doc))).toEqual(["u0", "T9", "u1", "X", "u2", "T14", "u3"]);
    // Later than 14:00: right after T14; untimed stops keep their order around it.
    setPlaceTime(doc, x, "16:00", "alice");
    expect(names(day0(doc))).toEqual(["u0", "T9", "u1", "u2", "T14", "X", "u3"]);
    // Earliest: just before the first timed stop, after the untimed stop that leads the day.
    setPlaceTime(doc, x, "08:00", "alice");
    expect(names(day0(doc))).toEqual(["u0", "X", "T9", "u1", "u2", "T14", "u3"]);
  });

  it("an equal time goes after the stops already at that time", () => {
    const { doc, dayId } = trip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId, time: "09:00" }, "alice");
    addPlace(doc, { name: "B", category: "sight", dayId, time: "10:00" }, "alice");
    addPlace(doc, { name: "C", category: "sight", dayId, time: "11:00" }, "alice");
    setPlaceTime(doc, a, "10:00", "alice");
    expect(names(day0(doc))).toEqual(["B", "A", "C"]);
  });

  it("setPlaceTime rejects 24:00 and garbage", () => {
    const { doc, dayId } = trip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId, time: "09:00" }, "alice");
    for (const bad of ["24:00", "9:00", "12:60", "noon", "", "12:00:00", " 12:00"]) {
      expect(setPlaceTime(doc, a, bad, "alice")).toBe(false);
    }
    expect(day0(doc).places[0].time).toBe("09:00");
    expect(setPlaceTime(doc, a, "23:59", "alice")).toBe(true);
    expect(setPlaceTime(doc, a, "00:00", "alice")).toBe(true);
    expect(setPlaceTime(doc, "gone", "10:00", "alice")).toBe(false);
  });

  it("a malformed time in the document reads as untimed", () => {
    const { doc, dayId } = trip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId }, "alice");
    for (const bad of ["24:00", 900, { h: 9 }, "9am"]) {
      doc.getMap<Y.Map<unknown>>("places").get(a)!.set("time", bad);
      expect(day0(doc).places[0].time).toBeNull();
    }
  });

  it("setPlaceTime is one transaction with the acting user as origin", () => {
    const { doc, dayId } = trip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId, time: "09:00" }, "alice");
    addPlace(doc, { name: "B", category: "sight", dayId, time: "10:00" }, "alice");
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    setPlaceTime(doc, a, "11:00", "bob");
    expect(origins).toEqual(["bob"]);
  });

  it("migrateDayStart moves startTime onto the first stop once", () => {
    const { doc } = trip(3);
    const [d1, d2, d3] = readTrip(doc).days.map((d) => d.id);
    const days = doc.getMap<Y.Map<unknown>>("days");
    // Legacy days: a start time on each.
    days.get(d1)!.set("startTime", "07:30");
    days.get(d2)!.set("startTime", "10:00");
    days.get(d3)!.set("startTime", "08:00");
    addPlace(doc, { name: "First", category: "food", dayId: d1 }, "alice");
    addPlace(doc, { name: "Second", category: "sight", dayId: d1 }, "alice");
    addPlace(doc, { name: "Timed", category: "food", dayId: d2, time: "11:00" }, "alice");

    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    migrateDayStart(doc, "alice");
    expect(origins).toEqual(["alice"]);
    const view = readTrip(doc);
    expect(view.days[0].places.map((p) => p.time)).toEqual(["07:30", null]);
    // A first stop with its own time keeps it.
    expect(view.days[1].places[0].time).toBe("11:00");
    expect(view.days[2].places).toEqual([]);
    for (const id of [d1, d2, d3]) expect(days.get(id)!.has("startTime")).toBe(false);

    // Once: a second run writes nothing.
    const before = Y.encodeStateVector(doc);
    migrateDayStart(doc, "alice");
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(origins).toEqual(["alice"]);
  });

  it("migrateDayStart drops the untouched 09:00 default without setting a time", () => {
    const { doc } = trip(2);
    const [d1, d2] = readTrip(doc).days.map((d) => d.id);
    const days = doc.getMap<Y.Map<unknown>>("days");
    days.get(d1)!.set("startTime", "09:00");
    days.get(d2)!.set("startTime", "09:01");
    addPlace(doc, { name: "Default day", category: "food", dayId: d1 }, "alice");
    addPlace(doc, { name: "Chosen day", category: "food", dayId: d2 }, "alice");
    migrateDayStart(doc, "migration");
    const view = readTrip(doc);
    expect(view.days[0].places[0].time).toBeNull();
    expect(view.days[1].places[0].time).toBe("09:01");
    expect(days.get(d1)!.has("startTime")).toBe(false);
    expect(days.get(d2)!.has("startTime")).toBe(false);
  });
});

describe("movePlace with retime", () => {
  function abc() {
    const { doc, dayId } = trip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId, stayMinutes: 120, time: "10:00" }, "alice");
    const c = addPlace(doc, { name: "C", category: "sight", dayId, stayMinutes: 60, time: "11:00" }, "alice");
    const b = addPlace(doc, { name: "B", category: "sight", dayId, stayMinutes: 30, time: "15:00" }, "alice");
    const u = addPlace(doc, { name: "U", category: "sight", dayId, stayMinutes: 30 }, "alice");
    return { doc, dayId, a, b, c, u };
  }

  it("a timed stop dropped between A and C stays there, clamped to C's time, and C shows late", () => {
    const { doc, dayId, a, b, c } = abc();
    expect(names(day0(doc))).toEqual(["A", "C", "B", "U"]);
    expect(movePlace(doc, b, { dayId, afterId: a }, "alice", { retime: true })).toBe(true);
    const day = day0(doc);
    expect(names(day)).toEqual(["A", "B", "C", "U"]);
    // Suggested 12:00 (A 10:00 + 120 min), clamped to the next timed stop's 11:00.
    expect(day.places[1].time).toBe("11:00");
    const timeline = dayTimeline(day, []);
    expect(timeline.find((e) => e.placeId === c)!.lateBy).toBe(30);
  });

  it("the retimed drop is one transaction and one undo step", () => {
    const { doc, dayId, a, b } = abc();
    const undo = createUndo(doc, "alice");
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    movePlace(doc, b, { dayId, afterId: a }, "alice", { retime: true });
    expect(origins).toEqual(["alice"]);
    undo.undo();
    expect(names(day0(doc))).toEqual(["A", "C", "B", "U"]);
    expect(day0(doc).places[2].time).toBe("15:00");
  });

  it("a timed stop takes the suggested time when it fits the slot", () => {
    const { doc, dayId, b, c } = abc();
    movePlace(doc, b, { dayId, afterId: c }, "alice", { retime: true });
    // Nothing timed after: C 11:00 + 60 min.
    expect(day0(doc).places.map((p) => [p.name, p.time])).toEqual([["A", "10:00"], ["C", "11:00"], ["B", "12:00"], ["U", null]]);
  });

  it("with no suggestion the old time is kept if it fits, else clamped", () => {
    const { doc, dayId, a, b, c } = abc();
    // First in the day: nothing before, so no suggestion; 15:00 is after A's 10:00, clamped to it.
    movePlace(doc, b, { dayId, beforeId: a }, "alice", { retime: true });
    expect(day0(doc).places.map((p) => [p.name, p.time]).slice(0, 2)).toEqual([["B", "10:00"], ["A", "10:00"]]);
    setPlaceTime(doc, c, "09:30", "alice");
    expect(names(day0(doc))).toEqual(["C", "B", "A", "U"]);
    // C first again via a drop at the start: no suggestion, 09:30 fits before B, kept.
    movePlace(doc, c, { dayId, beforeId: null, afterId: null }, "alice", { retime: true });
    expect(day0(doc).places[0]).toMatchObject({ name: "C", time: "09:30" });
  });

  it("an untimed stop stays untimed, and without retime the time is untouched", () => {
    const { doc, dayId, a, b, u } = abc();
    movePlace(doc, u, { dayId, afterId: a }, "alice", { retime: true });
    expect(day0(doc).places[1]).toMatchObject({ name: "U", time: null });
    movePlace(doc, b, { dayId, beforeId: a }, "alice");
    expect(day0(doc).places[0]).toMatchObject({ name: "B", time: "15:00" });
  });
});

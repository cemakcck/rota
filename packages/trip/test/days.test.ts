import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addPlace, createUndo, dayNote, initTrip, moveDay, readTrip, removeDay, setDay, setPlaceTime, updatePlace } from "../src";
import { replica, sync } from "./helpers";

function trip(days = 4): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  initTrip(doc, { name: "Istanbul", startDate: "2026-11-30", days, locale: "en" }, "alice");
  return { doc, ids: readTrip(doc).days.map((d) => d.id) };
}

const order = (doc: Y.Doc) => readTrip(doc).days.map((d) => d.id);
const storedIndex = (doc: Y.Doc, id: string) => (doc.getMap("days").get(id) as Y.Map<unknown>).get("index");

describe("moveDay", () => {
  it("moves a day to a position; the dates follow the new order", () => {
    const { doc, ids } = trip();
    const [d1, d2, d3, d4] = ids;
    addPlace(doc, { name: "Balat", category: "sight", dayId: d3 }, "alice");
    expect(moveDay(doc, d3, 0, "alice")).toBe(true);
    const view = readTrip(doc);
    expect(view.days.map((d) => d.id)).toEqual([d3, d1, d2, d4]);
    expect(view.days.map((d) => d.date)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]);
    expect(view.days.map((d) => d.index)).toEqual([0, 1, 2, 3]);
    // Its places go with it.
    expect(view.days[0].places.map((p) => p.name)).toEqual(["Balat"]);

    moveDay(doc, d3, 3, "alice");
    expect(order(doc)).toEqual([d1, d2, d4, d3]);
    moveDay(doc, d1, 2, "alice");
    expect(order(doc)).toEqual([d2, d4, d1, d3]);
  });

  it("writes only the moved day's index when a number fits between its new neighbours", () => {
    const { doc, ids } = trip();
    const [d1, d2, d3, d4] = ids;
    const writes: string[] = [];
    doc.getMap("days").observeDeep((events) => {
      for (const e of events) if (e instanceof Y.YMapEvent && e.target !== doc.getMap("days")) writes.push(...e.keysChanged);
    });
    moveDay(doc, d4, 1, "alice");
    expect(order(doc)).toEqual([d1, d4, d2, d3]);
    expect(writes).toEqual(["index"]);
    expect([d1, d2, d3].map((id) => storedIndex(doc, id))).toEqual([0, 1, 2]);
  });

  it("clamps the position, and does nothing (no transaction) for an unknown day or the same place", () => {
    const { doc, ids } = trip(3);
    const [d1, d2, d3] = ids;
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    expect(moveDay(doc, "nope", 0, "alice")).toBe(false);
    expect(moveDay(doc, d2, 1, "alice")).toBe(false);
    expect(moveDay(doc, d2, Number.NaN, "alice")).toBe(false);
    expect(transactions).toBe(0);
    moveDay(doc, d1, 99, "alice");
    expect(order(doc)).toEqual([d2, d3, d1]);
    moveDay(doc, d1, -5, "alice");
    expect(order(doc)).toEqual([d1, d2, d3]);
  });

  it("renumbers the days when its neighbours' indexes tie (concurrent adds)", () => {
    const { doc, ids } = trip(2);
    const [d1, d2] = ids;
    // Two days added at once on two devices both take index 2.
    const days = doc.getMap("days");
    doc.transact(() => {
      for (const id of ["x-a", "x-b"]) {
        const m = new Y.Map<unknown>();
        m.set("index", 2);
        m.set("travelMode", "walk");
        m.set("note", new Y.XmlFragment());
        days.set(id, m);
      }
    });
    expect(order(doc)).toEqual([d1, d2, "x-a", "x-b"]);
    moveDay(doc, d1, 2, "alice");
    expect(order(doc)).toEqual([d2, "x-a", d1, "x-b"]);
    expect(readTrip(doc).days.map((d) => storedIndex(doc, d.id))).toEqual([0, 1, 2, 3]);
  });

  it("keeps working after many moves into the same gap", () => {
    const { doc, ids } = trip(3);
    const [d1, d2, d3] = ids;
    for (let i = 0; i < 80; i++) {
      moveDay(doc, i % 2 === 0 ? d3 : d2, 1, "alice");
    }
    expect(order(doc)).toEqual([d1, d2, d3]);
    expect(readTrip(doc).days.map((d) => d.date)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
  });

  it("concurrent moveDay and place edits converge, nothing lost", () => {
    const { doc: a, ids } = trip();
    const [d1, d2, d3, d4] = ids;
    const p = addPlace(a, { name: "Galata", category: "sight", dayId: d2, time: "10:00" }, "alice");
    const b = replica(a);
    moveDay(a, d2, 3, "alice");
    updatePlace(b, p, { name: "Galata Tower" }, "bob");
    setPlaceTime(b, p, "11:00", "bob");
    addPlace(b, { name: "Karaköy", category: "food", dayId: d2 }, "bob");
    setDay(b, d2, { title: "Galata" }, "bob");
    sync(a, b);
    const view = readTrip(a);
    expect(view).toEqual(readTrip(b));
    expect(view.days.map((d) => d.id)).toEqual([d1, d3, d4, d2]);
    expect(view.days[3].title).toBe("Galata");
    expect(view.days[3].date).toBe("2026-12-03");
    expect(view.days[3].places.map((x) => `${x.name}:${x.time}`)).toEqual(["Galata Tower:11:00", "Karaköy:null"]);
  });

  it("two people moving different days at once both land, the same on every device", () => {
    const { doc: a, ids } = trip();
    const [d1, d2, d3, d4] = ids;
    const b = replica(a);
    moveDay(a, d4, 0, "alice");
    moveDay(b, d2, 3, "bob");
    sync(a, b);
    expect(order(a)).toEqual(order(b));
    expect(order(a)).toEqual([d4, d1, d3, d2]);
    expect(new Set(order(a)).size).toBe(4);
  });

  it("is one undo step for the mover, and undo keeps a friend's edit made meanwhile", async () => {
    const { doc: a, ids } = trip(3);
    const [d1, d2, d3] = ids;
    const b = replica(a);
    const undo = createUndo(a, "alice");
    moveDay(a, d3, 0, "alice");
    sync(a, b);
    setDay(b, d3, { title: "Balat" }, "bob");
    addPlace(b, { name: "Fener", category: "sight", dayId: d3 }, "bob");
    sync(a, b);
    undo.undo();
    sync(a, b);
    for (const d of [a, b]) {
      const view = readTrip(d);
      expect(view.days.map((x) => x.id)).toEqual([d1, d2, d3]);
      expect(view.days[2].title).toBe("Balat");
      expect(view.days[2].places.map((x) => x.name)).toEqual(["Fener"]);
    }
    undo.destroy();
  });
});

describe("setDay", () => {
  it("writes nothing (no transaction) when nothing would change", () => {
    const { doc, ids } = trip(1);
    setDay(doc, ids[0], { title: "Balat" }, "alice");
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    setDay(doc, ids[0], { title: "  Balat " }, "alice");
    setDay(doc, ids[0], { travelMode: "walk" }, "alice");
    setDay(doc, ids[0], {}, "alice");
    expect(transactions).toBe(0);
    setDay(doc, ids[0], { travelMode: "drive" }, "alice");
    expect(transactions).toBe(1);
  });
});

describe("removeDay and undo", () => {
  it("one undo brings the day back with its places, times, title and note, keeping a friend's edit", () => {
    const { doc: a, ids } = trip(3);
    const [d1, d2, d3] = ids;
    setDay(a, d2, { title: "Karaköy" }, "alice");
    const note = dayNote(a, d2);
    a.transact(() => note.insert(0, [new Y.XmlText("Bring cash")]), "alice");
    const p1 = addPlace(a, { name: "Galata", category: "sight", dayId: d2, time: "10:00" }, "alice");
    const p2 = addPlace(a, { name: "Karaköy Lokantası", category: "food", dayId: d2 }, "alice");
    const b = replica(a);
    const undo = createUndo(a, "alice");
    removeDay(a, d2, "alice");
    expect(readTrip(a).ideas.map((p) => p.id)).toEqual([p1, p2]);
    sync(a, b);
    // Meanwhile Bob renames a moved place (now in Ideas).
    updatePlace(b, p1, { name: "Galata Tower" }, "bob");
    sync(a, b);
    undo.undo();
    sync(a, b);
    for (const d of [a, b]) {
      const view = readTrip(d);
      expect(view.days.map((x) => x.id)).toEqual([d1, d2, d3]);
      expect(view.days[1].title).toBe("Karaköy");
      expect(view.days[1].places.map((p) => `${p.name}:${p.time}`)).toEqual(["Galata Tower:10:00", "Karaköy Lokantası:null"]);
      expect(view.ideas).toEqual([]);
      expect(dayNote(d, d2).toString()).toContain("Bring cash");
    }
    undo.destroy();
  });
});

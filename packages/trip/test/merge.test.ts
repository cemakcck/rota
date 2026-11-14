import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addChecklistItem,
  addPlace,
  deletePlace,
  initTrip,
  moveChecklistItem,
  movePlace,
  placeNote,
  readTrip,
  removeDay,
  setDay,
  setPlaceTime,
  setTripMeta,
  updateChecklistItem,
  updatePlace,
  type TripView,
} from "../src";
import { replica, sync } from "./helpers";

function trip(days = 3): Y.Doc {
  const doc = new Y.Doc();
  initTrip(doc, { name: "Istanbul", startDate: "2026-11-30", days, locale: "en" }, "alice");
  return doc;
}

/** Every place in every list, by id. */
function allPlaceIds(view: TripView): string[] {
  return [
    ...view.days.flatMap((d) => d.places),
    ...view.ideas,
    ...view.suggestions,
    ...view.dismissed,
  ].map((p) => p.id);
}

describe("merging concurrent edits", () => {
  it("naive Y.Array move duplicates a place under concurrent moves", () => {
    // The approach we do NOT use: each day is a Y.Array of place ids and a move
    // is delete + insert. Two people moving the same place at once both delete
    // the same item (deleted once) but each insert their own copy.
    const a = new Y.Doc();
    a.getArray<string>("day1").push(["galata", "hagia-sophia"]);
    a.getArray<string>("day2");
    a.getArray<string>("day3");
    const b = replica(a);

    a.transact(() => {
      a.getArray<string>("day1").delete(0, 1);
      a.getArray<string>("day2").push(["galata"]);
    });
    b.transact(() => {
      b.getArray<string>("day1").delete(0, 1);
      b.getArray<string>("day3").push(["galata"]);
    });
    sync(a, b);

    const copies = ["day1", "day2", "day3"].flatMap((d) => a.getArray<string>(d).toArray()).filter((id) => id === "galata");
    expect(copies).toHaveLength(2);
  });

  it("concurrent moves of the same place leave exactly one copy", () => {
    const a = trip();
    const [d1, d2, d3] = readTrip(a).days.map((d) => d.id);
    const galata = addPlace(a, { name: "Galata Tower", category: "sight", dayId: d1 }, "alice");
    addPlace(a, { name: "Hagia Sophia", category: "museum", dayId: d1 }, "alice");
    const b = replica(a);

    expect(movePlace(a, galata, { dayId: d2 }, "alice")).toBe(true);
    expect(movePlace(b, galata, { dayId: d3 }, "bob")).toBe(true);
    sync(a, b);

    const va = readTrip(a);
    expect(va).toEqual(readTrip(b));
    expect(allPlaceIds(va).filter((id) => id === galata)).toHaveLength(1);
    expect(va.days[0].places.map((p) => p.name)).toEqual(["Hagia Sophia"]);
    expect([va.days[1].places.length, va.days[2].places.length].sort()).toEqual([0, 1]);
  });

  it("concurrent move and delete: the place stays deleted", () => {
    const a = trip();
    const [d1, d2] = readTrip(a).days.map((d) => d.id);
    const galata = addPlace(a, { name: "Galata Tower", category: "sight", dayId: d1 }, "alice");
    const b = replica(a);

    deletePlace(a, galata, "alice");
    expect(movePlace(b, galata, { dayId: d2 }, "bob")).toBe(true);
    updatePlace(b, galata, { name: "Galata Kulesi" }, "bob");
    sync(a, b);

    expect(readTrip(a)).toEqual(readTrip(b));
    expect(allPlaceIds(readTrip(a))).not.toContain(galata);
    expect(readTrip(a).placeCount).toBe(0);
  });

  it("moving a place someone deleted is a no-op", () => {
    const a = trip();
    const [d1, d2] = readTrip(a).days.map((d) => d.id);
    const galata = addPlace(a, { name: "Galata Tower", category: "sight", dayId: d1 }, "alice");
    const b = replica(a);
    deletePlace(a, galata, "alice");
    sync(a, b);

    const before = Y.encodeStateVector(b);
    let updates = 0;
    b.on("update", () => updates++);
    expect(movePlace(b, galata, { dayId: d2 }, "bob")).toBe(false);
    expect(updates).toBe(0);
    expect(Y.encodeStateVector(b)).toEqual(before);
  });

  it("concurrent inserts at the same position keep both in a stable order", () => {
    const a = trip();
    const d1 = readTrip(a).days[0].id;
    addPlace(a, { name: "Hagia Sophia", category: "museum", dayId: d1 }, "alice");
    const b = replica(a);

    const fromA = addPlace(a, { name: "Galata Tower", category: "sight", dayId: d1 }, "alice");
    const fromB = addPlace(b, { name: "Karaköy Lokantası", category: "food", dayId: d1 }, "bob");
    sync(a, b);

    const va = readTrip(a);
    expect(va).toEqual(readTrip(b));
    const ids = va.days[0].places.map((p) => p.id);
    expect(ids).toHaveLength(3);
    expect(ids.slice(1)).toEqual([fromA, fromB].sort());

    // Dropping a place between the tied pair lands it between them (the tied
    // neighbour gets a fresh key in the same transaction), on both replicas.
    const between = addPlace(a, { name: "Between", category: "other", dayId: null }, "alice");
    expect(movePlace(a, between, { dayId: d1, afterId: ids[1], beforeId: ids[2] }, "alice")).toBe(true);
    sync(a, b);
    expect(readTrip(a).days[0].places.map((p) => p.id)).toEqual([ids[0], ids[1], between, ids[2]]);
    expect(readTrip(b)).toEqual(readTrip(a));
  });

  it("an item dropped into a group of three tied checklist items lands where asked", () => {
    const a = trip();
    const b = replica(a);
    const c = replica(a);
    const items = [
      addChecklistItem(a, "Passports", "alice"),
      addChecklistItem(b, "Tickets", "bob"),
      addChecklistItem(c, "Adapter", "carol"),
    ];
    sync(a, b);
    sync(a, c);
    sync(a, b);
    const tied = readTrip(a).checklist;
    expect(new Set(tied.map((i) => i.order)).size).toBe(1);
    const ids = tied.map((i) => i.id);

    const sunscreen = addChecklistItem(a, "Sunscreen", "alice");
    expect(moveChecklistItem(a, sunscreen, { afterId: ids[0], beforeId: ids[1] }, "alice")).toBe(true);
    expect(readTrip(a).checklist.map((i) => i.id)).toEqual([ids[0], sunscreen, ids[1], ids[2]]);
    expect(items.every((id) => readTrip(a).checklist.some((i) => i.id === id))).toBe(true);
  });

  it("concurrent edits to one note keep both", () => {
    const a = trip();
    const galata = addPlace(a, { name: "Galata Tower", category: "sight", dayId: null }, "alice");
    a.transact(() => {
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText("Book tickets")]);
      placeNote(a, galata).insert(0, [paragraph]);
    }, "alice");
    const b = replica(a);

    const textIn = (doc: Y.Doc) => (placeNote(doc, galata).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    a.transact(() => textIn(a).insert(textIn(a).length, " online"), "alice");
    b.transact(() => textIn(b).insert(0, "Remember: "), "bob");
    sync(a, b);

    expect(textIn(a).toString()).toBe("Remember: Book tickets online");
    expect(placeNote(b, galata).toString()).toBe(placeNote(a, galata).toString());
  });

  it("an offline doc with 50 edits merges with a doc that changed meanwhile", () => {
    const online = trip();
    const days = readTrip(online).days.map((d) => d.id);
    const shared = addPlace(online, { name: "Galata Tower", category: "sight", dayId: days[0] }, "alice");
    const offline = replica(online);

    const offlineIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      if (i % 5 === 4) {
        movePlace(offline, offlineIds[i - 1], { dayId: days[i % 3], beforeId: null }, "bob");
        offlineIds.push(offlineIds[i - 1]);
      } else if (i % 5 === 3) {
        updatePlace(offline, offlineIds[i - 1], { name: `Renamed ${i}`, tags: ["offline"] }, "bob");
        offlineIds.push(offlineIds[i - 1]);
      } else {
        offlineIds.push(addPlace(offline, { name: `Offline ${i}`, category: "food", dayId: days[i % 3] }, "bob"));
      }
    }
    setDay(online, days[1], { travelMode: "drive" }, "alice");
    setTripMeta(online, { name: "Istanbul trip" }, "alice");
    const onlineAdded = addPlace(online, { name: "Online place", category: "cafe", dayId: days[0] }, "alice");
    updatePlace(online, shared, { stayMinutes: 90 }, "alice");
    sync(online, offline);

    const view = readTrip(online);
    expect(view).toEqual(readTrip(offline));
    const ids = allPlaceIds(view);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of new Set(offlineIds)) expect(ids).toContain(id);
    expect(ids).toContain(onlineAdded);
    expect(view.placeCount).toBe(new Set(offlineIds).size + 2);
    expect(view.name).toBe("Istanbul trip");
    expect(view.days[1]).toMatchObject({ travelMode: "drive" });
    expect(view.days.flatMap((d) => d.places).find((p) => p.id === shared)!.stayMinutes).toBe(90);
    expect(view.days.flatMap((d) => d.places).filter((p) => p.name.startsWith("Renamed"))).toHaveLength(10);
  });

  it("removing a day moves its places to Ideas", () => {
    const a = trip();
    const [d1, d2] = readTrip(a).days.map((d) => d.id);
    const idea = addPlace(a, { name: "Existing idea", category: "other", dayId: null }, "alice");
    const p1 = addPlace(a, { name: "First", category: "sight", dayId: d2 }, "alice");
    const p2 = addPlace(a, { name: "Second", category: "food", dayId: d2 }, "alice");
    const b = replica(a);

    removeDay(a, d2, "alice");
    // Meanwhile Bob adds to the day Alice is removing: it must not vanish.
    const late = addPlace(b, { name: "Late addition", category: "cafe", dayId: d2 }, "bob");
    sync(a, b);

    const view = readTrip(a);
    expect(view).toEqual(readTrip(b));
    expect(view.days.map((d) => d.id)).not.toContain(d2);
    expect(view.days.map((d) => d.date)).toEqual(["2026-11-30", "2026-12-01"]);
    expect(view.days[0].id).toBe(d1);
    // Bob's late place keeps the key it got in the removed day, so it may sort
    // anywhere among the moved places; the others keep their relative order.
    expect(view.ideas.map((p) => p.id).filter((id) => id !== late)).toEqual([idea, p1, p2]);
    expect(view.ideas.map((p) => p.id)).toContain(late);
    expect(view.placeCount).toBe(4);
  });

  it("concurrent checklist ticks and edits converge", () => {
    const a = trip();
    const passports = addChecklistItem(a, "Passports", "alice");
    const tickets = addChecklistItem(a, "Museum tickets", "alice");
    const b = replica(a);

    updateChecklistItem(a, passports, { done: true }, "alice");
    updateChecklistItem(b, passports, { text: "Passports and IDs", assignee: "bob" }, "bob");
    updateChecklistItem(a, tickets, { done: true }, "alice");
    updateChecklistItem(b, tickets, { done: false }, "bob");
    const fromB = addChecklistItem(b, "Power adapter", "bob");
    sync(a, b);

    const view = readTrip(a);
    expect(view.checklist).toEqual(readTrip(b).checklist);
    expect(view.checklist.map((i) => i.id)).toEqual([passports, tickets, fromB]);
    expect(view.checklist[0]).toMatchObject({ text: "Passports and IDs", done: true, assignee: "bob" });
    expect(typeof view.checklist[1].done).toBe("boolean");
  });

  it("concurrent setPlaceTime on two peers converges with one copy", () => {
    const a = trip(1);
    const [day] = readTrip(a).days.map((d) => d.id);
    const breakfast = addPlace(a, { name: "Breakfast", category: "food", dayId: day, time: "08:30" }, "alice");
    const museum = addPlace(a, { name: "Museum", category: "museum", dayId: day, time: "10:00" }, "alice");
    const walk = addPlace(a, { name: "Walk", category: "sight", dayId: day }, "alice");
    const lunch = addPlace(a, { name: "Lunch", category: "food", dayId: day, time: "13:00" }, "alice");
    const b = replica(a);

    // The same stop re-timed differently on each peer, and two stops given the same new time.
    setPlaceTime(a, museum, "14:00", "alice");
    setPlaceTime(b, museum, "07:00", "bob");
    setPlaceTime(a, walk, "12:00", "alice");
    setPlaceTime(b, breakfast, "12:00", "bob");
    sync(a, b);

    const view = readTrip(a);
    expect(view).toEqual(readTrip(b));
    const ids = view.days[0].places.map((p) => p.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids)).toEqual(new Set([breakfast, museum, walk, lunch]));
    // One writer won the museum's time and its order together.
    const m = view.days[0].places.find((p) => p.id === museum)!;
    expect(["14:00", "07:00"]).toContain(m.time);
    const index = ids.indexOf(museum);
    if (m.time === "07:00") expect(index).toBe(0);
    else expect(index).toBe(3);
  });
});

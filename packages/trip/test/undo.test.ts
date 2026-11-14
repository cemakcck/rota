import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addPlace, createUndo, deletePlace, movePlace, readTrip, updatePlace, vote, initTrip } from "../src";
import { replica, sync } from "./helpers";

function setup() {
  const a = new Y.Doc();
  initTrip(a, { name: "Istanbul", startDate: "2026-11-30", days: 2, locale: "en" }, "A");
  const b = replica(a);
  return { a, b, days: readTrip(a).days.map((d) => d.id) };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("undo", () => {
  it("undo reverts only my own edits", async () => {
    const { a, b, days } = setup();
    const id = addPlace(a, { name: "Galata", category: "sight", dayId: days[0] }, "A");
    const other = addPlace(a, { name: "Pera", category: "sight", dayId: days[0] }, "A");
    sync(a, b);
    const undoA = createUndo(a, "A");
    await wait(550);
    updatePlace(a, id, { name: "Galata Tower" }, "A");
    movePlace(b, other, { dayId: days[1] }, "B");
    sync(a, b);
    undoA.undo();
    sync(a, b);
    for (const d of [a, b]) {
      const places = readTrip(d).days.flatMap((x) => x.places);
      expect(places.find((p) => p.id === id)?.name).toBe("Galata");
      expect(readTrip(d).days[1].places.map((p) => p.id)).toEqual([other]);
    }
    undoA.destroy();
  });

  it("undo restores a deleted place with its votes and tags", () => {
    const { a, days } = setup();
    const id = addPlace(a, { name: "Çiya", category: "food", tags: ["lunch"], dayId: days[0] }, "A");
    vote(a, id, "B", 1);
    const u = createUndo(a, "A");
    deletePlace(a, id, "A");
    expect(readTrip(a).placeCount).toBe(0);
    u.undo();
    const p = readTrip(a).days[0].places[0];
    expect(p.tags).toEqual(["lunch"]);
    expect(p.votes).toEqual({ B: 1 });
    u.destroy();
  });

  it("redo re-applies", () => {
    const { a, days } = setup();
    const id = addPlace(a, { name: "Galata", category: "sight", dayId: days[0] }, "A");
    const u = createUndo(a, "A");
    updatePlace(a, id, { name: "New" }, "A");
    expect(u.canUndo()).toBe(true);
    u.undo();
    expect(u.canRedo()).toBe(true);
    u.redo();
    expect(readTrip(a).days[0].places[0].name).toBe("New");
    expect(u.canRedo()).toBe(false);
    u.destroy();
  });

  it("edits within 500 ms undo as one step", async () => {
    const { a, days } = setup();
    const id = addPlace(a, { name: "Galata", category: "sight", dayId: days[0] }, "A");
    const u = createUndo(a, "A");
    updatePlace(a, id, { name: "One" }, "A");
    updatePlace(a, id, { name: "Two" }, "A");
    u.undo();
    expect(readTrip(a).days[0].places[0].name).toBe("Galata");
    expect(u.canUndo()).toBe(false);
    u.destroy();
    await wait(0);
  });

  it("stopCapturing starts a new undo step, so a delete undoes on its own", () => {
    const { a, days } = setup();
    const id = addPlace(a, { name: "Galata", category: "sight", dayId: days[0] }, "A");
    const u = createUndo(a, "A");
    updatePlace(a, id, { name: "Galata Tower" }, "A");
    u.stopCapturing();
    deletePlace(a, id, "A");
    u.undo();
    expect(readTrip(a).days[0].places[0].name).toBe("Galata Tower");
    u.destroy();
  });
});

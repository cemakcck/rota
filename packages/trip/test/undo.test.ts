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

  it("a step can be marked, and undone only while it is still the last thing this person did", () => {
    const { a, b, days } = setup();
    const id = addPlace(a, { name: "Galata", category: "sight", dayId: days[0] }, "A");
    const u = createUndo(a, "A");
    expect(u.mark()).toBeNull();
    u.stopCapturing();
    deletePlace(a, id, "A");
    const mark = u.mark();
    expect(mark).not.toBeNull();
    // A friend's edit does not change what is mine to undo.
    sync(a, b);
    addPlace(b, { name: "Pera", category: "museum", dayId: days[1] }, "B");
    sync(a, b);
    expect(u.mark()).toBe(mark);
    // My own later edit does: the marked step is no longer undone.
    u.stopCapturing();
    const other = addPlace(a, { name: "Balat", category: "sight", dayId: days[1] }, "A");
    expect(u.undoMark(mark!)).toBe(false);
    expect(readTrip(a).days[1].places.map((p) => p.id)).toContain(other);
    expect(readTrip(a).placeCount).toBe(2);
    // Undone by Ctrl+Z, the later edit goes; now the mark is the top again and undoes.
    u.undo();
    expect(u.undoMark(mark!)).toBe(true);
    expect(readTrip(a).days[0].places.map((p) => p.name)).toEqual(["Galata"]);
    // Already undone: nothing more.
    expect(u.undoMark(mark!)).toBe(false);
    u.destroy();
  });

  it("undoing a marked step that a friend fully overwrote changes nothing, and never undoes the step before it", () => {
    const { a, b, days } = setup();
    const u = createUndo(a, "A");
    const id = addPlace(a, { name: "Galata", category: "sight", dayId: days[0] }, "A");
    u.stopCapturing();
    movePlace(a, id, { dayId: days[1] }, "A");
    const mark = u.mark()!;
    sync(a, b);
    // Bob moves it on to Ideas: every field my move wrote is now his.
    movePlace(b, id, { dayId: null }, "B");
    sync(a, b);
    u.undoMark(mark);
    // Plain Y.UndoManager.undo() would go on to undo my add (it pops until something changes).
    expect(readTrip(a).ideas.map((p) => p.id)).toEqual([id]);
    expect(u.canUndo()).toBe(true);
    u.destroy();
  });

  it("step runs an action as its own step and marks it, or marks nothing when it changed nothing", () => {
    const { a, days } = setup();
    const u = createUndo(a, "A");
    const id = u.step(() => addPlace(a, { name: "Galata", category: "sight", dayId: days[0] }, "A"));
    const added = u.lastStep();
    expect(added).toBe(u.mark());
    u.step(() => updatePlace(a, id, { name: "Galata Tower" }, "A"));
    expect(u.lastStep()).not.toBe(added);
    // Nothing changed: no mark (a toast for it offers no Undo).
    u.step(() => movePlace(a, "gone", { dayId: days[1] }, "A"));
    expect(u.lastStep()).toBeNull();
    u.destroy();
  });

  it("after undoMark, listeners hear of it with the stack as it really is", () => {
    const { a, days } = setup();
    const u = createUndo(a, "A");
    const id = u.step(() => addPlace(a, { name: "Galata", category: "sight", dayId: days[0] }, "A"));
    u.step(() => updatePlace(a, id, { name: "Galata Tower" }, "A"));
    const seen: boolean[] = [];
    u.onChange(() => seen.push(u.canUndo()));
    u.undoMark(u.lastStep()!);
    // The add is still there to undo; the last word listeners get says so.
    expect(seen.at(-1)).toBe(true);
    u.destroy();
  });
});

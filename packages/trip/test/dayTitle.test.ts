import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { DAY_TITLE_MAX, createUndo, initTrip, readTrip, seedDemoTrip, setDay } from "../src";

function trip(): { doc: Y.Doc; dayId: string } {
  const doc = new Y.Doc();
  initTrip(doc, { name: "Istanbul", startDate: "2026-11-30", days: 2, locale: "en" }, "alice");
  return { doc, dayId: readTrip(doc).days[0].id };
}

describe("day titles", () => {
  it("a new day has no title", () => {
    const { doc } = trip();
    expect(readTrip(doc).days.map((d) => d.title)).toEqual(["", ""]);
  });

  it("setDay sets, trims, caps at 40 characters and clears a title", () => {
    const { doc, dayId } = trip();
    setDay(doc, dayId, { title: "  Karaköy & Galata  " }, "alice");
    expect(readTrip(doc).days[0].title).toBe("Karaköy & Galata");
    expect(readTrip(doc).days[1].title).toBe("");
    setDay(doc, dayId, { title: "x".repeat(60) }, "alice");
    expect(DAY_TITLE_MAX).toBe(40);
    expect(readTrip(doc).days[0].title).toBe("x".repeat(40));
    setDay(doc, dayId, { title: "   " }, "alice");
    expect(readTrip(doc).days[0].title).toBe("");
  });

  it("is one undo step for its author", () => {
    const { doc, dayId } = trip();
    const undo = createUndo(doc, "alice");
    setDay(doc, dayId, { title: "Old city" }, "alice");
    undo.undo();
    expect(readTrip(doc).days[0].title).toBe("");
  });

  it("a malformed title written by a peer reads as none, and an over-long one is capped", () => {
    const { doc, dayId } = trip();
    const day = doc.getMap<Y.Map<unknown>>("days").get(dayId)!;
    day.set("title", 42);
    expect(readTrip(doc).days[0].title).toBe("");
    day.set("title", "y".repeat(80));
    expect(readTrip(doc).days[0].title).toBe("y".repeat(40));
  });

  it("the demo trip's days have titles, in its language", () => {
    const member = (id: string, name: string) => ({ id, name, colour: "#1e3a8a" });
    const seed = (locale: "en" | "tr") => {
      const doc = new Y.Doc();
      seedDemoTrip(doc, { today: "2026-11-15", locale, owner: member("o", "You"), deniz: member("d", "Deniz"), selin: member("s", "Selin") });
      return readTrip(doc).days.map((d) => d.title);
    };
    const en = seed("en");
    expect(en[0]).toBe("Karaköy & Galata");
    expect(en.every((t) => t.length > 0 && t.length <= 40)).toBe(true);
    const tr = seed("tr");
    expect(tr.every((t) => t.length > 0 && t.length <= 40)).toBe(true);
    expect(tr).not.toEqual(en);
  });
});

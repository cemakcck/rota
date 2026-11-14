import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addChecklistItem, addPlace, initTrip, newTripId, placeNote, removeMember, setTripMeta, upsertMember, vote, deletePlace, dayNote } from "@rota/trip";
import {
  PENDING_STALE_MS,
  adoptStalePending,
  changedRecords,
  clearPending,
  closePending,
  forgetPending,
  pendingCount,
  recordPending,
} from "@/client/sync/pending";

/** The record keys one transaction by `origin` touches. */
function recordsOf(doc: Y.Doc, change: () => void): string[] {
  let keys: string[] = [];
  const listen = (tr: Y.Transaction) => {
    keys = changedRecords(tr);
  };
  doc.on("afterTransaction", listen);
  doc.transact(change, "u-ada");
  doc.off("afterTransaction", listen);
  return keys.sort();
}

function trip() {
  const doc = new Y.Doc();
  initTrip(doc, { name: "Lisbon", startDate: "2026-12-04", days: 2, locale: "en" }, "seed");
  const placeId = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: null }, "seed");
  const dayId = [...doc.getMap("days").keys()][0];
  return { doc, placeId, dayId };
}

describe("changedRecords", () => {
  it("names each changed place, day, checklist item, and the trip settings once", () => {
    const { doc, placeId, dayId } = trip();
    expect(recordsOf(doc, () => setTripMeta(doc, { name: "Lisbon and Porto", startDate: "2026-12-05" }, "u-ada"))).toEqual(["meta"]);
    expect(recordsOf(doc, () => vote(doc, placeId, "u-ada", 1))).toEqual([`places:${placeId}`]);
    let itemId = "";
    expect(recordsOf(doc, () => (itemId = addChecklistItem(doc, "Tickets", "u-ada")))).toEqual([`checklist:${itemId}`]);
    expect(
      recordsOf(doc, () => {
        const text = new Y.XmlText("Ferry at 9");
        const paragraph = new Y.XmlElement("paragraph");
        paragraph.insert(0, [text]);
        dayNote(doc, dayId).insert(0, [paragraph]);
        setTripMeta(doc, { name: "Porto" }, "u-ada");
      }),
    ).toEqual([`days:${dayId}`, "meta"]);
    expect(recordsOf(doc, () => deletePlace(doc, placeId, "u-ada"))).toEqual([`places:${placeId}`]);
  });

  it("text typed into a place's note is that place", () => {
    const { doc, placeId } = trip();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("")]);
    placeNote(doc, placeId).insert(0, [paragraph]);
    const text = paragraph.get(0) as Y.XmlText;
    expect(recordsOf(doc, () => text.insert(0, "Queue at sunset"))).toEqual([`places:${placeId}`]);
    expect(recordsOf(doc, () => text.format(0, 5, { bold: true }))).toEqual([`places:${placeId}`]);
  });

  it("member changes are not changes the user waits for", () => {
    const { doc } = trip();
    expect(recordsOf(doc, () => upsertMember(doc, { id: "u-deniz", name: "Deniz", colour: "#ea580c" }))).toEqual([]);
    expect(recordsOf(doc, () => removeMember(doc, "u-deniz"))).toEqual([]);
  });
});

describe("pending records per tab", () => {
  const tripId = newTripId();
  afterEach(() => localStorage.clear());

  it("counts the union of every tab's records, and a tab clears only its own", () => {
    recordPending(tripId, "tab-a", ["meta", "places:p1"], 1000);
    recordPending(tripId, "tab-b", ["places:p1", "checklist:c1"], 1000);
    recordPending(tripId, "tab-a", ["meta"], 1000);
    expect(pendingCount(tripId)).toBe(3);
    clearPending(tripId, "tab-a");
    expect(pendingCount(tripId)).toBe(2);
    expect(pendingCount(newTripId())).toBe(0);
  });

  it("a tab adopts the records of tabs that stopped beating, and leaves live ones alone", () => {
    const now = 100_000;
    recordPending(tripId, "closed-tab", ["meta", "places:p1"], now - PENDING_STALE_MS - 1);
    recordPending(tripId, "live-tab", ["checklist:c1"], now - 1000);
    recordPending(tripId, "me", ["places:p2"], now);

    adoptStalePending(tripId, "me", now);

    expect(localStorage.getItem(`rota.pending.${tripId}.closed-tab`)).toBeNull();
    expect(localStorage.getItem(`rota.pending.${tripId}.live-tab`)).not.toBeNull();
    const mine = JSON.parse(localStorage.getItem(`rota.pending.${tripId}.me`)!);
    expect(mine.keys.sort()).toEqual(["meta", "places:p1", "places:p2"]);
    expect(pendingCount(tripId)).toBe(4);
  });

  it("a hidden tab beating once a minute is not stale; three minutes without a beat is", () => {
    expect(PENDING_STALE_MS).toBe(3 * 60_000);
    const now = 1_000_000;
    recordPending(tripId, "hidden-tab", ["meta"], now - 70_000);
    recordPending(tripId, "gone-tab", ["places:p1"], now - 3 * 60_000 - 1);
    adoptStalePending(tripId, "me", now);
    expect(localStorage.getItem(`rota.pending.${tripId}.hidden-tab`)).not.toBeNull();
    expect(localStorage.getItem(`rota.pending.${tripId}.gone-tab`)).toBeNull();
    expect(JSON.parse(localStorage.getItem(`rota.pending.${tripId}.me`)!).keys).toEqual(["places:p1"]);
  });

  it("a closed tab's records are adopted at once", () => {
    const now = 1_000_000;
    recordPending(tripId, "closing-tab", ["meta"], now);
    closePending(tripId, "closing-tab");
    closePending(tripId, "tab-without-entry");
    expect(localStorage.getItem(`rota.pending.${tripId}.tab-without-entry`)).toBeNull();
    expect(pendingCount(tripId)).toBe(1);
    adoptStalePending(tripId, "me", now);
    expect(localStorage.getItem(`rota.pending.${tripId}.closing-tab`)).toBeNull();
    expect(pendingCount(tripId)).toBe(1);
  });

  it("survives corrupted entries and forgets every tab's entry for a trip", () => {
    localStorage.setItem(`rota.pending.${tripId}.junk`, "{nope");
    localStorage.setItem(`rota.pending.${tripId}.wrong`, JSON.stringify({ keys: "meta", heartbeat: 1 }));
    recordPending(tripId, "tab-a", ["meta"], 1000);
    expect(pendingCount(tripId)).toBe(1);
    const other = newTripId();
    recordPending(other, "tab-a", ["meta"], 1000);

    forgetPending(tripId);

    expect(pendingCount(tripId)).toBe(0);
    expect(Object.keys(localStorage).filter((k) => k.startsWith(`rota.pending.${tripId}`))).toEqual([]);
    expect(pendingCount(other)).toBe(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { MAP_CURSOR_MS, peers, setEditing, setMapCursor } from "@/client/presence";

const open: Awareness[] = [];
function connection(state?: Record<string, unknown>): Awareness {
  const awareness = new Awareness(new Y.Doc());
  open.push(awareness);
  if (state) awareness.setLocalState(state);
  return awareness;
}
/** Delivers `from`'s current state to `to`, as the server would. */
function relay(from: Awareness, to: Awareness) {
  applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [from.clientID]), "remote");
}

afterEach(() => {
  open.splice(0).forEach((a) => a.destroy());
  vi.useRealTimers();
});

const deniz = { id: "u2", name: "Deniz", colour: "#ea580c" };
const selin = { id: "u3", name: "Selin", colour: "#16a34a" };

describe("presence", () => {
  it("peers dedups the same user across two tabs", () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    const me = connection({ user: { id: "u1", name: "Ann", colour: "#2563eb" }, editing: null, cursor: null });
    const myOtherTab = connection({ user: { id: "u1", name: "Ann", colour: "#2563eb" }, editing: "p9", cursor: null });
    const denizLaptop = connection({ user: deniz, editing: "p1", cursor: null });
    const denizPhone = connection({ user: deniz, editing: null, cursor: { lat: 41, lng: 29 } });
    const selinTab = connection({ user: selin, editing: null, cursor: null });
    const anonymous = connection();

    relay(myOtherTab, me);
    relay(denizLaptop, me);
    vi.setSystemTime(1_005_000);
    relay(denizPhone, me);
    relay(selinTab, me);
    relay(anonymous, me);

    const found = peers(me, "u1");
    expect(found.map((p) => p.user.id).sort()).toEqual(["u2", "u3"]);
    // Deniz's phone spoke last, so its state wins over the laptop's.
    expect(found.find((p) => p.user.id === "u2")).toMatchObject({ clientId: denizPhone.clientID, editing: null, cursor: { lat: 41, lng: 29 } });

    // Then the laptop speaks again: now it is the newest.
    vi.setSystemTime(1_010_000);
    setEditing(denizLaptop, "p2");
    relay(denizLaptop, me);
    expect(peers(me, "u1").find((p) => p.user.id === "u2")).toMatchObject({ clientId: denizLaptop.clientID, editing: "p2" });
  });

  it("setMapCursor is throttled", () => {
    vi.useFakeTimers({ now: 0 });
    const me = connection({ user: { id: "u1", name: "Ann", colour: "#2563eb" }, editing: null, cursor: null });
    const published: unknown[] = [];
    me.on("change", () => published.push(me.getLocalState()?.cursor));

    setMapCursor(me, { lat: 41, lng: 29 });
    expect(published).toEqual([{ lat: 41, lng: 29 }]);
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(5);
      setMapCursor(me, { lat: 41 + i / 100, lng: 29 });
    }
    // Moves within one 50 ms window are collapsed into the latest, sent when the window ends.
    expect(published).toHaveLength(1);
    expect(MAP_CURSOR_MS).toBe(50);
    vi.advanceTimersByTime(MAP_CURSOR_MS);
    expect(published).toEqual([{ lat: 41, lng: 29 }, { lat: 41.05, lng: 29 }]);

    // Leaving the map clears the cursor (after the window), and a later move goes out at once.
    setMapCursor(me, null);
    vi.advanceTimersByTime(MAP_CURSOR_MS);
    expect(published.at(-1)).toBeNull();
    vi.advanceTimersByTime(500);
    setMapCursor(me, { lat: 40, lng: 28 });
    expect(published.at(-1)).toEqual({ lat: 40, lng: 28 });
    expect(published).toHaveLength(4);
  });
});

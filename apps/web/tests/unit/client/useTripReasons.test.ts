import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { addChecklistItem, addPlace, createUndo, initTrip, newTripId, placeNote, readTrip, setTripMeta } from "@rota/trip";
import { PENDING_STALE_MS, recordPending } from "@/client/sync/pending";
import { forgetTrip } from "@/client/myTrips";
import { useTrip } from "@/client/sync/useTrip";

type ProviderConfig = { url: string; name: string; document: Y.Doc; token: string };

const { StubProvider } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const { readTrip } = await import("@rota/trip");
  /** Stands in for HocuspocusProvider: records how it was made and lets the test emit server events. */
  class StubProvider extends EventEmitter {
    static made: StubProvider[] = [];
    unsyncedChanges = 0;
    synced = false;
    awareness = null;
    connects = 0;
    disconnects = 0;
    /** The trip's name as it was in the document when the provider was attached. */
    nameAtAttach: string;
    /** Like the real provider: every update it did not apply itself is sent and waits for the server's ack. */
    private countUnsynced = (_update: Uint8Array, origin: unknown) => {
      if (origin !== this) this.unsyncedChanges++;
    };
    constructor(readonly configuration: ProviderConfig) {
      super();
      this.nameAtAttach = readTrip(configuration.document).name;
      configuration.document.on("update", this.countUnsynced);
      StubProvider.made.push(this);
    }
    connect() {
      this.connects++;
    }
    disconnect() {
      this.disconnects++;
    }
    destroy() {
      this.configuration.document.off("update", this.countUnsynced);
      this.removeAllListeners();
    }
  }
  return { StubProvider };
});

vi.mock("@hocuspocus/provider", () => ({ HocuspocusProvider: StubProvider }));
/**
 * The user a hook instance signs in as: kept from its first render like a real tab's session (an unknown
 * user can become known later). With `live` on, every render reads the current value, so a test can
 * change the signed-in user inside one tab.
 */
const signedIn = vi.hoisted(() => ({ userId: "u-ada" as string | null, live: false }));
vi.mock("@/client/authClient", async (original) => {
  const { useState } = await import("react");
  return {
    ...(await original<typeof import("@/client/authClient")>()),
    useUserId: () => {
      const first = useState(() => signedIn.userId)[0];
      return signedIn.live ? signedIn.userId : (first ?? signedIn.userId);
    },
  };
});

/** A trip already on this device, in each listed user's own copy. */
async function seedLocalTrip(name: string, users: string[] = ["u-ada"]): Promise<string> {
  const id = newTripId();
  const doc = new Y.Doc();
  initTrip(doc, { name, startDate: "2026-12-04", days: 3, locale: "en" }, "seed");
  addPlace(doc, { name: "Galata Tower", category: "sight", dayId: null }, "seed");
  for (const user of users) {
    const idb = new IndexeddbPersistence(`rota-trip-${id}-${user}`, doc);
    await idb.whenSynced;
    await idb.destroy();
  }
  return id;
}

/** The server has everything this tab sent. */
function acknowledge(provider: InstanceType<typeof StubProvider>) {
  provider.emit("status", { status: "connected" });
  provider.synced = true;
  provider.unsyncedChanges = 0;
  provider.emit("synced", { state: true });
  provider.emit("unsyncedChanges", { number: 0 });
}

async function openTrip(id: string) {
  const before = StubProvider.made.length;
  const hook = renderHook(() => useTrip(id));
  await waitFor(() => expect(StubProvider.made.length).toBe(before + 1));
  const provider = StubProvider.made.at(-1)!;
  expect(provider.configuration.name).toBe(id);
  return { hook, provider };
}

/** This trip's pending entries in localStorage, one per tab. */
const pendingEntries = (tripId: string, user = "u-ada"): { keys: string[]; heartbeat: number }[] =>
  Object.keys(localStorage)
    .filter((k) => k.startsWith(`rota.pending.${tripId}.${user}.`))
    .map((k) => JSON.parse(localStorage.getItem(k)!));

const databaseNames = async () => (await indexedDB.databases()).map((d) => d.name);

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

/** What this user's IndexedDB copy of the trip holds. */
async function storedCopy(tripId: string, user: string) {
  const doc = new Y.Doc();
  const idb = new IndexeddbPersistence(`rota-trip-${tripId}-${user}`, doc);
  await idb.whenSynced;
  await idb.destroy();
  return readTrip(doc);
}

/** Opens a trip as Ada, who renames it while offline (an unsent edit, kept in her copy), then changes the tab's user. */
async function switchUserAfterUnsentEdit(next: string | null) {
  signedIn.live = true;
  const id = await seedLocalTrip("Lisbon");
  const ada = await openTrip(id);
  act(() => ada.hook.result.current.simulateOffline(true));
  act(() => {
    setTripMeta(ada.hook.result.current.doc, { name: "Ada's unsent rename" }, "u-ada");
  });
  await act(settle);
  expect((await storedCopy(id, "u-ada")).name).toBe("Ada's unsent rename");
  const made = StubProvider.made.length;
  signedIn.userId = next;
  ada.hook.rerender();
  await waitFor(() => expect(StubProvider.made.length).toBe(made + 1));
  await act(settle);
  return { id, hook: ada.hook, adaProvider: ada.provider, after: StubProvider.made.slice(made) };
}

afterEach(() => {
  signedIn.userId = "u-ada";
  signedIn.live = false;
  StubProvider.made = [];
  localStorage.clear();
});

describe("useTrip", () => {
  it("loads IndexedDB first, then attaches the provider to /sync with the cookie token", async () => {
    const id = await seedLocalTrip("Istanbul long weekend");
    const { hook, provider } = await openTrip(id);

    expect(provider.nameAtAttach).toBe("Istanbul long weekend");
    expect(provider.configuration).toMatchObject({ url: `ws://${location.host}/sync`, name: id, token: "cookie" });
    expect(provider.configuration.document).toBe(hook.result.current.doc);
    await waitFor(() => expect(hook.result.current.view.name).toBe("Istanbul long weekend"));
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.userId).toBe("u-ada");
    hook.unmount();
  });

  it("a legacy day's start time moves onto its first stop once the trip has synced, and Undo cannot revert it", async () => {
    const id = newTripId();
    const legacy = new Y.Doc();
    initTrip(legacy, { name: "Legacy", startDate: "2026-12-04", days: 1, locale: "en" }, "seed");
    const [day] = readTrip(legacy).days;
    legacy.getMap<Y.Map<unknown>>("days").get(day.id)!.set("startTime", "07:30");
    addPlace(legacy, { name: "Simit stand", category: "food", dayId: day.id }, "seed");
    const idb = new IndexeddbPersistence(`rota-trip-${id}-u-ada`, legacy);
    await idb.whenSynced;
    await idb.destroy();

    const { hook, provider } = await openTrip(id);
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    const doc = hook.result.current.doc;
    const undo = createUndo(doc, "u-ada");
    // The device copy may be stale: nothing is migrated until the server sync is done.
    await act(settle);
    expect(readTrip(doc).days[0].places[0].time).toBeNull();
    act(() => acknowledge(provider));
    await waitFor(() => expect(readTrip(doc).days[0].places[0].time).toBe("07:30"));
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
    expect(doc.getMap<Y.Map<unknown>>("days").get(day.id)!.has("startTime")).toBe(false);
    hook.unmount();
  });

  it("removed reason shows closed=removed and keeps the local doc until forgetTrip", async () => {
    const id = await seedLocalTrip("Istanbul long weekend");
    const { hook, provider } = await openTrip(id);

    act(() => {
      provider.emit("close", { event: { code: 4205, reason: "removed" } });
    });

    expect(hook.result.current.closed).toBe("removed");
    expect(provider.disconnects).toBeGreaterThan(0);
    act(() => hook.result.current.simulateOffline(false));
    expect(provider.connects).toBe(0);
    expect(readTrip(hook.result.current.doc).name).toBe("Istanbul long weekend");
    expect(await databaseNames()).toContain(`rota-trip-${id}-u-ada`);

    hook.unmount();
    await forgetTrip(id, "u-ada");
    expect(await databaseNames()).not.toContain(`rota-trip-${id}-u-ada`);
  });

  it.each([
    ["authenticationFailed", { reason: "deleted" }, "deleted"],
    ["authenticationFailed", { reason: "not-found" }, "not-found"],
    ["authenticationFailed", { reason: "unauthorized" }, "unauthorized"],
    ["close", { event: { code: 4403, reason: "deleted" } }, "deleted"],
    ["close", { event: { code: 4403, reason: "removed" } }, "removed"],
  ] as const)("%s %j closes the trip as %s", async (event, payload, closed) => {
    const id = await seedLocalTrip("Lisbon");
    const { hook, provider } = await openTrip(id);
    act(() => {
      provider.emit(event, payload);
    });
    expect(hook.result.current.closed).toBe(closed);
    hook.unmount();
  });

  it("an ordinary disconnect or a full trip does not close it", async () => {
    const id = await seedLocalTrip("Lisbon");
    const { hook, provider } = await openTrip(id);
    act(() => {
      provider.emit("close", { event: { code: 1006, reason: "" } });
      provider.emit("close", { event: { code: 4429, reason: "full" } });
    });
    expect(hook.result.current.closed).toBeNull();
    expect(provider.disconnects).toBe(0);
    hook.unmount();
  });

  it("reports pending changes and simulated offline", async () => {
    const id = await seedLocalTrip("Lisbon");
    const { hook, provider } = await openTrip(id);
    act(() => {
      provider.emit("status", { status: "connected" });
      provider.synced = true;
      provider.emit("synced", { state: true });
    });
    expect(hook.result.current.status).toEqual({ kind: "synced", pending: 0 });

    act(() => hook.result.current.simulateOffline(true));
    act(() => {
      provider.emit("status", { status: "disconnected" });
      setTripMeta(hook.result.current.doc, { name: "Lisbon and Porto" }, "u-ada");
      addChecklistItem(hook.result.current.doc, "Tickets", "u-ada");
    });
    expect(provider.disconnects).toBe(1);
    expect(hook.result.current.status).toEqual({ kind: "offline", pending: 2 });

    act(() => hook.result.current.simulateOffline(false));
    expect(provider.connects).toBe(1);
    hook.unmount();
  });

  it("a first open while online but not yet connected is syncing, not offline", async () => {
    const { hook, provider } = await openTrip(newTripId());
    expect(hook.result.current.status).toEqual({ kind: "syncing", pending: 0 });
    act(() => {
      provider.emit("status", { status: "connecting" });
    });
    expect(hook.result.current.status.kind).toBe("syncing");
    expect(hook.result.current.ready).toBe(false);
    expect(hook.result.current.firstOpenOffline).toBe(false);
    hook.unmount();
  });

  it("a first open while offline says so instead of showing an empty trip", async () => {
    const { hook } = await openTrip(newTripId());
    act(() => hook.result.current.simulateOffline(true));
    expect(hook.result.current.ready).toBe(false);
    expect(hook.result.current.firstOpenOffline).toBe(true);
    hook.unmount();
  });

  it("changes made offline are still waiting after a reload, until the server has them", async () => {
    const id = await seedLocalTrip("Lisbon");
    const first = await openTrip(id);
    act(() => first.hook.result.current.simulateOffline(true));
    act(() => {
      setTripMeta(first.hook.result.current.doc, { name: "Lisbon and Porto" }, "u-ada");
      setTripMeta(first.hook.result.current.doc, { startDate: "2026-12-05" }, "u-ada");
      addChecklistItem(first.hook.result.current.doc, "Tickets", "u-ada");
    });
    expect(first.hook.result.current.status).toEqual({ kind: "offline", pending: 2 });
    first.hook.unmount();

    // Reopened later: the closed tab's records are adopted, so this tab's acknowledgement clears them.
    const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + PENDING_STALE_MS + 1000);
    try {
      const again = await openTrip(id);
      await waitFor(() => expect(again.hook.result.current.view.name).toBe("Lisbon and Porto"));
      act(() => again.hook.result.current.simulateOffline(true));
      expect(again.hook.result.current.status).toEqual({ kind: "offline", pending: 2 });

      act(() => again.hook.result.current.simulateOffline(false));
      act(() => acknowledge(again.provider));
      expect(again.hook.result.current.status).toEqual({ kind: "synced", pending: 0 });
      again.hook.unmount();

      const third = await openTrip(id);
      expect(third.hook.result.current.status.pending).toBe(0);
      third.hook.unmount();
    } finally {
      later.mockRestore();
    }
  });

  it("a tab that is closing hands its changes over at once (pagehide)", async () => {
    const id = await seedLocalTrip("Lisbon");
    const first = await openTrip(id);
    act(() => {
      setTripMeta(first.hook.result.current.doc, { name: "Lisbon and Porto" }, "u-ada");
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    first.hook.unmount();

    const next = await openTrip(id);
    expect(next.hook.result.current.status.pending).toBe(1);
    act(() => acknowledge(next.provider));
    expect(next.hook.result.current.status.pending).toBe(0);
    next.hook.unmount();
  });

  it("a hidden tab refreshes its heartbeat when it becomes visible", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const id = await seedLocalTrip("Lisbon");
      const { hook } = await openTrip(id);
      act(() => {
        setTripMeta(hook.result.current.doc, { name: "Lisbon and Porto" }, "u-ada");
      });
      const entryKey = Object.keys(localStorage).find((k) => k.startsWith(`rota.pending.${id}.u-ada.`))!;
      const before = JSON.parse(localStorage.getItem(entryKey)!).heartbeat;
      vi.setSystemTime(Date.now() + 2 * 60_000);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(JSON.parse(localStorage.getItem(entryKey)!).heartbeat).toBe(before + 2 * 60_000);
      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("typing into a place's note is one change waiting, not one per keystroke", async () => {
    const id = await seedLocalTrip("Lisbon");
    const { hook } = await openTrip(id);
    act(() => hook.result.current.simulateOffline(true));
    const doc = hook.result.current.doc;
    const placeId = [...doc.getMap("places").keys()][0];
    const text = new Y.XmlText("");
    act(() => {
      doc.transact(() => {
        const paragraph = new Y.XmlElement("paragraph");
        paragraph.insert(0, [text]);
        placeNote(doc, placeId).insert(0, [paragraph]);
      }, "u-ada");
      for (const [i, ch] of [..."Queue is shortest at"].entries()) doc.transact(() => text.insert(i, ch), "u-ada");
    });
    expect(text.toString()).toHaveLength(20);
    expect(hook.result.current.status).toEqual({ kind: "offline", pending: 1 });
    hook.unmount();
  });

  it("two tabs: the count is the union, and one tab's acknowledgement does not clear the other's changes", async () => {
    const id = await seedLocalTrip("Lisbon");
    const a = await openTrip(id);
    const b = await openTrip(id);
    /** The browser tells other tabs about localStorage writes; jsdom has one window, so the test does. */
    const tellOtherTabs = () => window.dispatchEvent(new StorageEvent("storage", { key: `rota.pending.${id}.u-ada.x` }));

    act(() => {
      setTripMeta(a.hook.result.current.doc, { name: "Lisbon and Porto" }, "u-ada");
      tellOtherTabs();
      addChecklistItem(b.hook.result.current.doc, "Tickets", "u-ada");
      tellOtherTabs();
    });
    expect(a.hook.result.current.status.pending).toBe(2);
    expect(b.hook.result.current.status.pending).toBe(2);

    act(() => {
      acknowledge(a.provider);
      tellOtherTabs();
    });
    expect(a.hook.result.current.status.pending).toBe(1);
    expect(b.hook.result.current.status.pending).toBe(1);

    a.hook.unmount();
    b.hook.unmount();
    const reopened = await openTrip(id);
    expect(reopened.hook.result.current.status.pending).toBe(1);
    reopened.hook.unmount();
  });

  it("open tabs share edits: a closing tab's offline edits reach the other tab, whose ack covers them", async () => {
    const id = await seedLocalTrip("Lisbon");
    const a = await openTrip(id);
    const b = await openTrip(id);
    act(() => acknowledge(a.provider));

    // B's edit is not on the server yet (B's connection has not acknowledged it).
    act(() => {
      setTripMeta(b.hook.result.current.doc, { name: "Lisbon and Porto" }, "u-ada");
    });
    // Tab A gets B's edit over the channel, as a change from another tab: not A's own pending change.
    await waitFor(() => expect(a.hook.result.current.view.name).toBe("Lisbon and Porto"));
    expect(a.provider.unsyncedChanges).toBe(1);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: `rota.pending.${id}.u-ada.x` }));
    });
    expect(a.hook.result.current.status.pending).toBe(1);

    // B closes; A adopts B's records at its next beat, and they wait for A's ack.
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    b.hook.unmount();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Adopted: B's closed entry (heartbeat 0) is gone and A's own, live entry holds its records.
    await waitFor(() => expect(pendingEntries(id).map((e) => e.heartbeat > 0)).toEqual([true]));
    expect(a.hook.result.current.status.pending).toBe(1);
    act(() => acknowledge(a.provider));
    expect(a.hook.result.current.status.pending).toBe(0);
    expect(readTrip(a.provider.configuration.document).name).toBe("Lisbon and Porto");
    a.hook.unmount();
  });

  it("tabs of different people (visitor and friend window) do not relay to each other", async () => {
    const id = await seedLocalTrip("Lisbon", ["u-ada", "u-deniz"]);
    const visitor = await openTrip(id);
    signedIn.userId = "u-deniz";
    const friend = await openTrip(id);
    act(() => {
      setTripMeta(friend.hook.result.current.doc, { name: "Deniz's Lisbon" }, "u-deniz");
      setTripMeta(visitor.hook.result.current.doc, { startDate: "2026-12-05" }, "u-ada");
    });
    await act(settle);
    expect(readTrip(visitor.hook.result.current.doc).name).toBe("Lisbon");
    expect(readTrip(friend.hook.result.current.doc).startDate).toBe("2026-12-04");
    visitor.hook.unmount();
    friend.hook.unmount();
  });

  it("visitor and friend in one browser: separate copies, separate counts, no takeover of the other's changes", async () => {
    const id = await seedLocalTrip("Lisbon", ["u-ada"]);
    const visitor = await openTrip(id);
    signedIn.userId = "u-deniz";
    const friend = await openTrip(id);
    // The friend has no copy of their own yet: theirs is not the visitor's.
    expect(await databaseNames()).toContain(`rota-trip-${id}-u-deniz`);
    expect(friend.hook.result.current.ready).toBe(false);

    act(() => {
      setTripMeta(visitor.hook.result.current.doc, { name: "Lisbon and Porto" }, "u-ada");
      addChecklistItem(friend.hook.result.current.doc, "Tickets", "u-deniz");
      addChecklistItem(friend.hook.result.current.doc, "Sunscreen", "u-deniz");
      window.dispatchEvent(new StorageEvent("storage", { key: `rota.pending.${id}.u-deniz.x` }));
      window.dispatchEvent(new StorageEvent("storage", { key: `rota.pending.${id}.u-ada.x` }));
    });
    expect(visitor.hook.result.current.status.pending).toBe(1);
    expect(friend.hook.result.current.status.pending).toBe(2);

    // The friend window closes; the visitor's tab must not take over Deniz's changes.
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    friend.hook.unmount();
    act(() => acknowledge(visitor.provider));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(settle);
    expect(visitor.hook.result.current.status.pending).toBe(0);
    expect(pendingEntries(id, "u-deniz")).toHaveLength(1);
    expect(readTrip(visitor.provider.configuration.document).checklist).toHaveLength(0);
    visitor.hook.unmount();
  });

  it("a tab whose user is unknown keeps no copy and records nothing, until the user is known", async () => {
    const id = newTripId();
    signedIn.userId = null;
    const unknown = await openTrip(id);
    act(() => {
      setTripMeta(unknown.hook.result.current.doc, { name: "Lisbon" }, "someone");
    });
    expect(Object.keys(localStorage).filter((k) => k.startsWith(`rota.pending.${id}`))).toEqual([]);
    expect((await databaseNames()).filter((n) => n?.startsWith(`rota-trip-${id}`))).toEqual([]);
    expect(unknown.hook.result.current.status.pending).toBe(0);

    signedIn.userId = "u-ada";
    unknown.hook.rerender();
    await waitFor(async () => expect(await databaseNames()).toContain(`rota-trip-${id}-u-ada`));
    unknown.hook.unmount();
  });

  it("a tab whose user changes to someone else gets a fresh document: the other user never stores or sends the first one's edits", async () => {
    const { id, hook, after } = await switchUserAfterUnsentEdit("u-deniz");
    const doc = hook.result.current.doc;
    expect(hook.result.current.userId).toBe("u-deniz");
    expect(readTrip(doc).name).not.toBe("Ada's unsent rename");
    for (const provider of after) {
      expect(provider.configuration.token).toBe("cookie");
      expect(provider.nameAtAttach).not.toBe("Ada's unsent rename");
      expect(readTrip(provider.configuration.document).name).not.toBe("Ada's unsent rename");
    }
    expect((await storedCopy(id, "u-deniz")).name).not.toBe("Ada's unsent rename");
    // Deniz's edits stay out of Ada's copy too.
    act(() => {
      addChecklistItem(doc, "Deniz's item", "u-deniz");
    });
    await act(settle);
    expect((await storedCopy(id, "u-ada")).checklist).toHaveLength(0);
    expect(hook.result.current.status.pending).toBe(1);
    hook.unmount();
  });

  it("a tab whose user becomes unknown gets a fresh document: its online-only connection never sends the user's edits", async () => {
    const { hook, after } = await switchUserAfterUnsentEdit(null);
    expect(hook.result.current.userId).toBeNull();
    expect(readTrip(hook.result.current.doc).name).not.toBe("Ada's unsent rename");
    for (const provider of after) {
      expect(provider.nameAtAttach).not.toBe("Ada's unsent rename");
      expect(readTrip(provider.configuration.document).name).not.toBe("Ada's unsent rename");
    }
    expect(hook.result.current.status.pending).toBe(0);
    hook.unmount();
  });

  it("a session that flaps (user, unknown, same user) keeps the user's unsent edits: the fresh document reloads them", async () => {
    const { id, hook } = await switchUserAfterUnsentEdit(null);
    const made = StubProvider.made.length;
    signedIn.userId = "u-ada";
    hook.rerender();
    await waitFor(() => expect(StubProvider.made.length).toBe(made + 1));
    const provider = StubProvider.made.at(-1)!;
    expect(provider.nameAtAttach).toBe("Ada's unsent rename");
    await waitFor(() => expect(hook.result.current.view.name).toBe("Ada's unsent rename"));
    expect(hook.result.current.status.pending).toBe(1);
    expect((await storedCopy(id, "u-ada")).name).toBe("Ada's unsent rename");
    act(() => acknowledge(provider));
    expect(hook.result.current.status.pending).toBe(0);
    hook.unmount();
  });

  it("a tab whose user is unknown joins no relay", async () => {
    const id = await seedLocalTrip("Lisbon");
    const known = await openTrip(id);
    signedIn.userId = null;
    const unknown = await openTrip(id);
    act(() => {
      setTripMeta(known.hook.result.current.doc, { name: "Lisbon and Porto" }, "u-ada");
    });
    await act(settle);
    // Nothing relayed, and no local copy either (the user is unknown): the document stays empty.
    expect(readTrip(unknown.hook.result.current.doc).name).toBe("");
    known.hook.unmount();
    unknown.hook.unmount();
  });

  it("a tab with Simulate offline on neither sends nor receives relayed edits, and resumes when it is off", async () => {
    const id = await seedLocalTrip("Lisbon");
    const a = await openTrip(id);
    const b = await openTrip(id);
    act(() => b.hook.result.current.simulateOffline(true));
    act(() => {
      setTripMeta(b.hook.result.current.doc, { name: "Offline name" }, "u-ada");
      setTripMeta(a.hook.result.current.doc, { startDate: "2026-12-05" }, "u-ada");
    });
    await act(settle);
    expect(readTrip(a.hook.result.current.doc).name).toBe("Lisbon");
    expect(readTrip(b.hook.result.current.doc).startDate).toBe("2026-12-04");

    act(() => b.hook.result.current.simulateOffline(false));
    act(() => {
      addChecklistItem(a.hook.result.current.doc, "Tickets", "u-ada");
      setTripMeta(b.hook.result.current.doc, { name: "Back online" }, "u-ada");
    });
    await waitFor(() => expect(readTrip(b.hook.result.current.doc).checklist).toHaveLength(1));
    await waitFor(() => expect(readTrip(a.hook.result.current.doc).name).toBe("Back online"));
    a.hook.unmount();
    b.hook.unmount();
  });

  it("before adopting, a tab re-reads IndexedDB, and only an ack after that clears the adopted records", async () => {
    const id = await seedLocalTrip("Lisbon");
    const a = await openTrip(id);
    act(() => acknowledge(a.provider));

    // Another tab wrote to IndexedDB without the channel (e.g. it was frozen), then went stale.
    const other = new Y.Doc();
    const idb = new IndexeddbPersistence(`rota-trip-${id}-u-ada`, other);
    await idb.whenSynced;
    setTripMeta(other, { name: "Lisbon and Porto" }, "u-ada");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await idb.destroy();
    recordPending(id, "u-ada", "frozen-tab", ["meta"], 0);
    expect(a.hook.result.current.view.name).toBe("Lisbon");

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(readTrip(a.provider.configuration.document).name).toBe("Lisbon and Porto"));
    await waitFor(() => expect(localStorage.getItem(`rota.pending.${id}.u-ada.frozen-tab`)).toBeNull());
    // Re-read content went to the server but is not acknowledged yet.
    expect(a.hook.result.current.status.pending).toBe(1);
    act(() => acknowledge(a.provider));
    expect(a.hook.result.current.status.pending).toBe(0);
    a.hook.unmount();
  });

  it("a tab that cannot sync (friend window waiting for its token) leaves its changes adoptable", async () => {
    window.history.replaceState(null, "", "/en/trips/x?friend=1");
    try {
      const id = await seedLocalTrip("Lisbon");
      const hook = renderHook(() => useTrip(id));
      await waitFor(() => expect(hook.result.current.ready).toBe(true));
      act(() => {
        setTripMeta(hook.result.current.doc, { name: "Lisbon and Porto" }, "u-deniz");
      });
      const entries = pendingEntries(id);
      expect(entries).toHaveLength(1);
      expect(entries[0].heartbeat).toBe(0);
      expect(hook.result.current.status.pending).toBe(1);
      hook.unmount();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("a friend window waits for its token instead of syncing as the visitor", async () => {
    window.history.replaceState(null, "", "/en/trips/x?friend=1");
    try {
      const id = await seedLocalTrip("Lisbon");
      const hook = renderHook(() => useTrip(id));
      await waitFor(() => expect(hook.result.current.ready).toBe(true));
      expect(StubProvider.made).toHaveLength(0);

      sessionStorage.setItem("rota.friend", JSON.stringify({ token: "friend-token", user: { id: "u-deniz", name: "Deniz", colour: "#ea580c" } }));
      hook.rerender();
      await waitFor(() => expect(StubProvider.made).toHaveLength(1));
      expect(StubProvider.made[0].configuration.token).toBe("friend-token");
      hook.unmount();
    } finally {
      sessionStorage.clear();
      window.history.replaceState(null, "", "/");
    }
  });

  it("without IndexedDB the trip still syncs, online only", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        throw new DOMException("The user denied permission to access the database.", "SecurityError");
      },
    });
    try {
      const id = newTripId();
      const { hook, provider } = await openTrip(id);
      expect(provider.configuration.name).toBe(id);
      expect(hook.result.current.ready).toBe(false);
      hook.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("if opening IndexedDB hangs, the trip syncs online only after a few seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("indexedDB", { open: () => ({}) });
    try {
      const id = newTripId();
      const hook = renderHook(() => useTrip(id));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2900);
      });
      expect(StubProvider.made).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(StubProvider.made).toHaveLength(1);
      hook.unmount();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

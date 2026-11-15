import { useSyncExternalStore } from "react";
import { act } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { initTrip, readTrip, upsertMember, type TripView } from "@rota/trip";
import type { TripSession } from "@/client/sync/useTrip";
import type { SyncStatus } from "@/client/sync/status";

// A stand-in for useTrip: a real Y.Doc and readTrip, without IndexedDB or a server. Tests mock
// "@/client/sync/useTrip" with `useFakeTrip` and drive `fake` directly.

type Fake = {
  doc: Y.Doc;
  view: TripView;
  userId: string | null;
  status: SyncStatus;
  closed: TripSession["closed"];
  firstOpenOffline: boolean;
  ready: boolean;
  /** This connection's presence (a real y-protocols Awareness on `doc`). */
  awareness: Awareness;
  /** Awareness states by client id, as presence would publish them (the awareness's own map). */
  states: Map<number, Record<string, unknown>>;
  /** What the screen passed to `simulateOffline`, in order. */
  simulated: boolean[];
};

/** Where this device remembers that u1 saw the tour (see client/tips). */
export const TIPS_SEEN_U1 = "rota.tipsSeen.u1";

const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

export const fake: Fake = {
  doc: new Y.Doc(),
  view: readTrip(new Y.Doc()),
  userId: "u1",
  status: { kind: "synced", pending: 0 },
  closed: null,
  firstOpenOffline: false,
  ready: true,
  awareness: new Awareness(new Y.Doc()),
  states: new Map(),
  simulated: [],
};

/**
 * A fresh trip ("Istanbul long weekend", 27 Nov 2026) with Ann (u1, the user) and Deniz (u2). Ann has
 * seen the first-time tour on this device, so it stays out of the way, unless `tour` is true.
 */
export function newTrip({ days = 2, tour = false }: { days?: number; tour?: boolean } = {}): { doc: Y.Doc; dayIds: string[] } {
  if (tour) localStorage.removeItem(TIPS_SEEN_U1);
  else localStorage.setItem(TIPS_SEEN_U1, "seen");
  const doc = new Y.Doc();
  initTrip(doc, { name: "Istanbul long weekend", startDate: "2026-11-27", days, locale: "en" }, "seed");
  upsertMember(doc, { id: "u1", name: "Ann", colour: "#2563eb" });
  upsertMember(doc, { id: "u2", name: "Deniz", colour: "#ea580c" });
  fake.doc = doc;
  fake.view = readTrip(doc);
  fake.userId = "u1";
  fake.status = { kind: "synced", pending: 0 };
  fake.closed = null;
  fake.firstOpenOffline = false;
  fake.ready = true;
  fake.awareness.destroy();
  fake.awareness = new Awareness(doc);
  fake.states = fake.awareness.states;
  fake.simulated = [];
  doc.on("update", () => {
    fake.view = readTrip(doc);
    notify();
  });
  return { doc, dayIds: fake.view.days.map((d) => d.id) };
}

/** Re-renders after changing `fake` fields other than the document. */
export function refresh() {
  act(() => notify());
}

/** Applies an edit made on another member's device (a second replica), as the server would deliver it. */
export function remoteEdit(as: string, edit: (doc: Y.Doc, origin: string) => void) {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(fake.doc));
  fake.states.set(remote.clientID, { user: { id: as } });
  const before = Y.encodeStateVector(fake.doc);
  edit(remote, as);
  act(() => Y.applyUpdate(fake.doc, Y.encodeStateAsUpdate(remote, before), "server"));
}

/** Another member's device that keeps its state (and its own undo) across edits; `push` delivers what it changed. */
export function remotePeer(as: string): { doc: Y.Doc; push(): void } {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(fake.doc));
  fake.states.set(remote.clientID, { user: { id: as } });
  return {
    doc: remote,
    push() {
      const update = Y.encodeStateAsUpdate(remote, Y.encodeStateVector(fake.doc));
      act(() => Y.applyUpdate(fake.doc, update, "server"));
    },
  };
}

/**
 * Another connection's presence arriving, as the server relays it: `set` publishes (or replaces) its
 * state, `leave` removes it. Each peer is a separate client id, like another tab or device.
 */
export function presencePeer(): { clientId: number; set(state: Record<string, unknown>): void; leave(): void } {
  const remote = new Awareness(new Y.Doc());
  const relay = () => act(() => applyAwarenessUpdate(fake.awareness, encodeAwarenessUpdate(remote, [remote.clientID]), "remote"));
  return {
    clientId: remote.clientID,
    set(state) {
      remote.setLocalState(state);
      relay();
    },
    leave() {
      remote.setLocalState(null);
      relay();
    },
  };
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function useFakeTrip(): TripSession {
  useSyncExternalStore(subscribe, () => version);
  return {
    doc: fake.doc,
    provider: null,
    view: fake.view,
    status: fake.status,
    ready: fake.ready,
    closed: fake.closed,
    firstOpenOffline: fake.firstOpenOffline,
    simulateOffline: (on) => void fake.simulated.push(on),
    awareness: fake.awareness,
    userId: fake.userId,
  };
}

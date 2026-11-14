import { useSyncExternalStore } from "react";
import { act } from "@testing-library/react";
import * as Y from "yjs";
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
  /** Awareness states by client id, as presence would publish them. */
  states: Map<number, Record<string, unknown>>;
};

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
  states: new Map(),
};

/** A fresh trip ("Istanbul long weekend", 27 Nov 2026) with Ann (u1, the user) and Deniz (u2). */
export function newTrip({ days = 2 }: { days?: number } = {}): { doc: Y.Doc; dayIds: string[] } {
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
  fake.states = new Map();
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
    simulateOffline: () => undefined,
    awareness: {
      getStates: () => fake.states,
      setLocalStateField: () => undefined,
    } as unknown as TripSession["awareness"],
    userId: fake.userId,
  };
}

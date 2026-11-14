"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { IndexeddbPersistence, fetchUpdates } from "y-indexeddb";
import * as Y from "yjs";
import { newId, readTrip, type TripView } from "@rota/trip";
import { syncToken, useUserId } from "../authClient";
import { markOfflineCopy, tripDatabaseName } from "../myTrips";
import {
  PENDING_HEARTBEAT_MS,
  adoptStalePending,
  changedRecords,
  clearPending,
  closePending,
  hasStalePending,
  heartbeatPending,
  isPendingStorageKey,
  pendingCount,
  recordPending,
} from "./pending";
import { syncStatus, type SyncStatus } from "./status";

/** Why the server will not sync this trip any more. The local copy stays until the user confirms `forgetTrip`. */
export type ClosedReason = "not-found" | "removed" | "deleted" | "unauthorized";
const CLOSED_REASONS: ReadonlySet<string> = new Set<ClosedReason>(["not-found", "removed", "deleted", "unauthorized"]);

export type TripSession = {
  doc: Y.Doc;
  provider: HocuspocusProvider | null;
  view: TripView;
  status: SyncStatus;
  /** The trip has content to show: from this device's copy or from the server. */
  ready: boolean;
  closed: ClosedReason | null;
  /** Nothing on this device and no connection: "Connect once to download this trip". */
  firstOpenOffline: boolean;
  simulateOffline(on: boolean): void;
  awareness: HocuspocusProvider["awareness"];
  /** Null when the user is not known (e.g. a friend window before its token): the UI blocks edits. */
  userId: string | null;
};

/** Origin of updates relayed from another open tab of the same trip. */
export const TAB_ORIGIN = "tab";

/** How long to wait for IndexedDB before syncing without a local copy (blocked or broken storage). */
export const LOCAL_OPEN_TIMEOUT_MS = 3000;

/**
 * Whether this browser's IndexedDB opens at all. Probed on a database of its own, so the trip's database
 * is still created by y-indexeddb with its stores; false if opening fails or hangs.
 */
function localStorageWorks(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), LOCAL_OPEN_TIMEOUT_MS);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    try {
      const request = indexedDB.open("rota-storage-check");
      request.onsuccess = () => {
        request.result.close();
        done(true);
      };
      request.onerror = () => done(false);
    } catch {
      done(false);
    }
  });
}

/** The same-origin WebSocket URL for `path`. */
export function wsUrl(path: string): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
}

type State = {
  tripId: string;
  doc: Y.Doc;
  provider: HocuspocusProvider | null;
  view: TripView;
  localLoaded: boolean;
  hasContent: boolean;
  online: boolean;
  simulatedOffline: boolean;
  connected: boolean;
  synced: boolean;
  unsynced: number;
  closed: ClosedReason | null;
};

type Action =
  | { type: "open"; tripId: string; userId: string | null }
  | { type: "local-loaded"; view: TripView; hasContent: boolean }
  | { type: "provider"; provider: HocuspocusProvider }
  | { type: "view"; view: TripView; hasContent: boolean }
  | { type: "online"; online: boolean }
  | { type: "simulate-offline"; on: boolean }
  | { type: "connected"; connected: boolean }
  | { type: "synced"; synced: boolean }
  | { type: "unsynced"; unsynced: number }
  | { type: "closed"; reason: ClosedReason };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "open":
      return initialState(action);
    case "local-loaded":
      return { ...state, localLoaded: true, view: action.view, hasContent: action.hasContent };
    case "provider":
      return { ...state, provider: action.provider };
    case "view":
      return { ...state, view: action.view, hasContent: action.hasContent };
    case "online":
      return { ...state, online: action.online };
    case "simulate-offline":
      return { ...state, simulatedOffline: action.on };
    case "connected":
      return { ...state, connected: action.connected };
    case "synced":
      return { ...state, synced: action.synced };
    case "unsynced":
      return { ...state, unsynced: action.unsynced };
    case "closed":
      return state.closed ? state : { ...state, closed: action.reason };
  }
}

function initialState({ tripId, userId }: { tripId: string; userId: string | null }): State {
  const doc = new Y.Doc();
  return {
    tripId,
    doc,
    provider: null,
    view: readTrip(doc),
    localLoaded: false,
    hasContent: false,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    simulatedOffline: false,
    connected: false,
    synced: false,
    unsynced: userId === null ? 0 : pendingCount(tripId, userId),
    closed: null,
  };
}

const hasContent = (doc: Y.Doc) => doc.store.clients.size > 0;

/**
 * Opens a trip: this device's IndexedDB copy first, then the sync connection. The provider is attached
 * only after the local copy has loaded, so its first sync carries the local state instead of pushing
 * it piecemeal while the server is still authenticating the connection. If IndexedDB cannot be used,
 * the trip syncs online only.
 */
export function useTrip(tripId: string): TripSession {
  const userId = useUserId();
  const token = syncToken();
  const [state, dispatch] = useReducer(reducer, { tripId, userId }, initialState);
  /** This tab's key for its pending changes (see pending.ts). */
  const [tabId] = useState(newId);
  // Another trip: start over with a fresh document (React re-renders before committing this one).
  if (state.tripId !== tripId) dispatch({ type: "open", tripId, userId });
  const { doc } = state;

  useEffect(() => {
    let disposed = false;
    let local: IndexeddbPersistence | null = null;
    let provider: HocuspocusProvider | null = null;
    let frame: number | null = null;

    // This device's copy and pending changes belong to the user; while the user is unknown the tab keeps
    // neither (online only) and opens its copy once the id is known.
    const user = userId;
    const recount = () => dispatch({ type: "unsynced", unsynced: user === null ? 0 : pendingCount(tripId, user) });
    /**
     * Records left by tabs that stopped beating become this tab's to deliver. IndexedDB is read again
     * first, so this document (which its provider sends) holds whatever such a tab stored there, and the
     * records are adopted only then: the next acknowledgement covers them.
     */
    let adopting = false;
    const adopt = async () => {
      if (adopting || !provider || user === null || !hasStalePending(tripId, user, tabId)) return;
      adopting = true;
      try {
        if (local) await fetchUpdates(local);
        if (disposed) return;
        adoptStalePending(tripId, user, tabId);
        recount();
        acknowledged();
      } finally {
        adopting = false;
      }
    };
    const beat = () => {
      // A tab that cannot sync (no provider, e.g. a friend window waiting for its token) never delivers
      // its records, so they stay adoptable by a tab that can.
      if (user !== null) {
        if (provider) heartbeatPending(tripId, user, tabId);
        else closePending(tripId, user, tabId);
      }
      recount();
      void adopt();
    };
    const beating = setInterval(beat, PENDING_HEARTBEAT_MS);
    const onStorage = (event: StorageEvent) => {
      if (user !== null && isPendingStorageKey(tripId, user, event.key)) recount();
    };
    window.addEventListener("storage", onStorage);
    // Hidden tabs beat rarely: beat as soon as one is shown again, and say so when it is closing.
    const onClosing = () => {
      if (user !== null) closePending(tripId, user, tabId);
    };
    document.addEventListener("visibilitychange", beat);
    window.addEventListener("pagehide", onClosing);

    /** The server has everything this tab sent: its own records are no longer waiting. */
    const acknowledged = () => {
      if (!provider?.synced || provider.unsyncedChanges !== 0 || user === null) return;
      clearPending(tripId, user, tabId);
      recount();
    };

    const onTransaction = (transaction: Y.Transaction) => {
      // Updates from the server, the local copy or another tab are not this tab's changes.
      const { origin } = transaction;
      if (user === null) return;
      if (origin === provider || origin === local || origin === TAB_ORIGIN) return;
      const records = changedRecords(transaction);
      if (records.length === 0) return;
      recordPending(tripId, user, tabId, records, provider ? Date.now() : 0);
      recount();
    };

    const onUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        dispatch({ type: "view", view: readTrip(doc), hasContent: hasContent(doc) });
      });
    };

    const close = (reason: string) => {
      if (!CLOSED_REASONS.has(reason)) return;
      // Stop reconnecting; edits made from now on stay local and are discarded with the message shown.
      provider?.disconnect();
      dispatch({ type: "closed", reason: reason as ClosedReason });
    };

    const attach = () => {
      if (disposed) return;
      doc.on("update", onUpdate);
      doc.on("afterTransaction", onTransaction);
      dispatch({ type: "local-loaded", view: readTrip(doc), hasContent: hasContent(doc) });
      // A friend window without its token yet must not connect with the visitor's cookie.
      if (token === null) return beat();
      provider = new HocuspocusProvider({ url: wsUrl("/sync"), name: tripId, document: doc, token });
      provider.on("status", ({ status }: { status: string }) => dispatch({ type: "connected", connected: status === "connected" }));
      provider.on("synced", ({ state: synced }: { state: boolean }) => {
        dispatch({ type: "synced", synced });
        if (synced && user !== null) markOfflineCopy(tripId, user);
        acknowledged();
      });
      provider.on("unsyncedChanges", acknowledged);
      provider.on("authenticationFailed", ({ reason }: { reason: string }) => close(reason));
      // Refusals after authentication arrive as a close reason (code 4403, or Hocuspocus' reset 4205).
      provider.on("close", ({ event }: { event: { reason: string } }) => close(event.reason));
      dispatch({ type: "provider", provider });
      beat();
    };

    localStorageWorks().then((works) => {
      if (disposed) return;
      if (!works || user === null) return attach();
      local = new IndexeddbPersistence(tripDatabaseName(tripId, user), doc);
      local.whenSynced.then(attach);
    });

    const onOnline = () => dispatch({ type: "online", online: true });
    const onOffline = () => dispatch({ type: "online", online: false });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("pagehide", onClosing);
      clearInterval(beating);
      if (frame !== null) cancelAnimationFrame(frame);
      doc.off("update", onUpdate);
      doc.off("afterTransaction", onTransaction);
      provider?.destroy();
      void local?.destroy();
    };
  }, [doc, tripId, token, tabId, userId]);

  // The same person's open tabs of the trip relay their edits to each other, so every tab's provider
  // sends everything. Scoped per user: in the demo, the visitor's window and the friend window are two
  // people, and one's offline edits must not reach the server through the other's connection. A tab
  // with Simulate offline on behaves as an offline device: it neither sends nor applies relayed edits.
  // A tab joining the relay, or coming back from Simulate offline, exchanges state vectors with the
  // others so each catches up on what it missed (a later update cannot apply without the earlier ones).
  const simulatedOffline = useRef(false);
  const relayCatchUp = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (userId === null || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`rota-trip-${tripId}-${userId}`);
    const bytes = (v: ArrayBufferView) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    /** Asks the other tabs for what this tab lacks; `reply` asks them to send their state vector back. */
    const catchUp = (reply = true) => channel.postMessage({ stateVector: Y.encodeStateVector(doc), reply });
    const onRelayed = ({ data }: MessageEvent) => {
      if (simulatedOffline.current) return;
      if (ArrayBuffer.isView(data)) {
        Y.applyUpdate(doc, bytes(data), TAB_ORIGIN);
        return;
      }
      const { stateVector, reply } = (data ?? {}) as { stateVector?: unknown; reply?: unknown };
      if (!ArrayBuffer.isView(stateVector)) return;
      channel.postMessage(Y.encodeStateAsUpdate(doc, bytes(stateVector)));
      if (reply === true) catchUp(false);
    };
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      // Only this tab's own edits: not the server's, the local copy's or another tab's.
      if (simulatedOffline.current || origin === TAB_ORIGIN) return;
      if (origin instanceof HocuspocusProvider || origin instanceof IndexeddbPersistence) return;
      channel.postMessage(update);
    };
    channel.addEventListener("message", onRelayed);
    doc.on("update", onUpdate);
    relayCatchUp.current = catchUp;
    if (!simulatedOffline.current) catchUp();
    return () => {
      relayCatchUp.current = null;
      doc.off("update", onUpdate);
      channel.close();
    };
  }, [doc, tripId, userId]);

  const { provider, closed } = state;
  const simulateOffline = useCallback(
    (on: boolean) => {
      simulatedOffline.current = on;
      dispatch({ type: "simulate-offline", on });
      if (on) {
        provider?.disconnect();
        return;
      }
      relayCatchUp.current?.();
      // A closed trip stays disconnected.
      if (!closed) void provider?.connect();
    },
    [provider, closed],
  );

  const status = syncStatus({
    online: state.online && !state.simulatedOffline,
    connected: state.connected,
    synced: state.synced,
    unsynced: state.unsynced,
  });
  const ready = state.localLoaded && state.hasContent;
  return {
    doc,
    provider,
    view: state.view,
    status,
    ready,
    closed,
    firstOpenOffline: state.localLoaded && !ready && status.kind === "offline",
    simulateOffline,
    awareness: provider?.awareness ?? null,
    userId,
  };
}

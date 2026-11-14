"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useReducer, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
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
  | { type: "open"; tripId: string }
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
      return initialState(action.tripId);
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

function initialState(tripId: string): State {
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
    unsynced: pendingCount(tripId),
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
  const [state, dispatch] = useReducer(reducer, tripId, initialState);
  /** This tab's key for its pending changes (see pending.ts). */
  const [tabId] = useState(newId);
  // Another trip: start over with a fresh document (React re-renders before committing this one).
  if (state.tripId !== tripId) dispatch({ type: "open", tripId });
  const { doc } = state;

  useEffect(() => {
    let disposed = false;
    let local: IndexeddbPersistence | null = null;
    let provider: HocuspocusProvider | null = null;
    let frame: number | null = null;

    const recount = () => dispatch({ type: "unsynced", unsynced: pendingCount(tripId) });
    // Records left by tabs that closed before the server had them become this tab's to deliver.
    const adopt = () => {
      adoptStalePending(tripId, tabId);
      heartbeatPending(tripId, tabId);
      recount();
    };
    adopt();
    const beat = setInterval(adopt, PENDING_HEARTBEAT_MS);
    const onStorage = (event: StorageEvent) => {
      if (isPendingStorageKey(tripId, event.key)) recount();
    };
    window.addEventListener("storage", onStorage);
    // Hidden tabs beat rarely: beat as soon as one is shown again, and say so when it is closing.
    const onClosing = () => closePending(tripId, tabId);
    document.addEventListener("visibilitychange", adopt);
    window.addEventListener("pagehide", onClosing);

    /** The server has everything this tab sent: its own records are no longer waiting. */
    const acknowledged = () => {
      if (!provider?.synced || provider.unsyncedChanges !== 0) return;
      clearPending(tripId, tabId);
      recount();
    };

    const onTransaction = (transaction: Y.Transaction) => {
      // Updates from the server or from the local copy are not this device's changes.
      if (transaction.origin === provider || transaction.origin === local) return;
      const records = changedRecords(transaction);
      if (records.length === 0) return;
      recordPending(tripId, tabId, records);
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
      if (token === null) return;
      provider = new HocuspocusProvider({ url: wsUrl("/sync"), name: tripId, document: doc, token });
      provider.on("status", ({ status }: { status: string }) => dispatch({ type: "connected", connected: status === "connected" }));
      provider.on("synced", ({ state: synced }: { state: boolean }) => {
        dispatch({ type: "synced", synced });
        if (synced) markOfflineCopy(tripId);
        acknowledged();
      });
      provider.on("unsyncedChanges", acknowledged);
      provider.on("authenticationFailed", ({ reason }: { reason: string }) => close(reason));
      // Refusals after authentication arrive as a close reason (code 4403, or Hocuspocus' reset 4205).
      provider.on("close", ({ event }: { event: { reason: string } }) => close(event.reason));
      dispatch({ type: "provider", provider });
    };

    localStorageWorks().then((works) => {
      if (disposed) return;
      if (!works) return attach();
      local = new IndexeddbPersistence(tripDatabaseName(tripId), doc);
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
      document.removeEventListener("visibilitychange", adopt);
      window.removeEventListener("pagehide", onClosing);
      clearInterval(beat);
      if (frame !== null) cancelAnimationFrame(frame);
      doc.off("update", onUpdate);
      doc.off("afterTransaction", onTransaction);
      provider?.destroy();
      void local?.destroy();
    };
  }, [doc, tripId, token, tabId]);

  const { provider, closed } = state;
  const simulateOffline = useCallback(
    (on: boolean) => {
      dispatch({ type: "simulate-offline", on });
      if (on) provider?.disconnect();
      // A closed trip stays disconnected.
      else if (!closed) void provider?.connect();
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

"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useReducer } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { readTrip, type TripView } from "@rota/trip";
import { syncToken, useUserId } from "../authClient";
import { markOfflineCopy, tripDatabaseName } from "../myTrips";
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
  userId: string;
};

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
  | { type: "local-loaded"; provider: HocuspocusProvider; view: TripView; hasContent: boolean }
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
      return { ...state, localLoaded: true, provider: action.provider, view: action.view, hasContent: action.hasContent };
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
    unsynced: 0,
    closed: null,
  };
}

const hasContent = (doc: Y.Doc) => doc.store.clients.size > 0;

/**
 * Opens a trip: this device's IndexedDB copy first, then the sync connection. The provider is attached
 * only after the local copy has loaded, so its first sync carries the local state instead of pushing
 * it piecemeal while the server is still authenticating the connection.
 */
export function useTrip(tripId: string): TripSession {
  const userId = useUserId();
  const [state, dispatch] = useReducer(reducer, tripId, initialState);
  // Another trip: start over with a fresh document (React re-renders before committing this one).
  if (state.tripId !== tripId) dispatch({ type: "open", tripId });
  const { doc } = state;

  useEffect(() => {
    let disposed = false;
    let provider: HocuspocusProvider | null = null;
    let frame: number | null = null;
    const local = new IndexeddbPersistence(tripDatabaseName(tripId), doc);

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

    local.whenSynced.then(() => {
      if (disposed) return;
      provider = new HocuspocusProvider({ url: wsUrl("/sync"), name: tripId, document: doc, token: syncToken() });
      provider.on("status", ({ status }: { status: string }) => dispatch({ type: "connected", connected: status === "connected" }));
      provider.on("synced", ({ state: synced }: { state: boolean }) => {
        dispatch({ type: "synced", synced });
        if (synced) markOfflineCopy(tripId);
      });
      provider.on("unsyncedChanges", ({ number }: { number: number }) => dispatch({ type: "unsynced", unsynced: number }));
      provider.on("authenticationFailed", ({ reason }: { reason: string }) => close(reason));
      // Refusals after authentication arrive as a close reason (code 4403, or Hocuspocus' reset 4205).
      provider.on("close", ({ event }: { event: { reason: string } }) => close(event.reason));
      doc.on("update", onUpdate);
      dispatch({ type: "local-loaded", provider, view: readTrip(doc), hasContent: hasContent(doc) });
    });

    const onOnline = () => dispatch({ type: "online", online: true });
    const onOffline = () => dispatch({ type: "online", online: false });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (frame !== null) cancelAnimationFrame(frame);
      doc.off("update", onUpdate);
      provider?.destroy();
      void local.destroy();
    };
  }, [doc, tripId]);

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

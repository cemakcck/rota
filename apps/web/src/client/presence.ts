"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";

/**
 * Presence: what each connection publishes in Yjs awareness (spec §9). The Announcer reads `user.id`
 * to name who made a change; avatars, the editing outline and map cursors read the rest.
 *
 * The note editor's caret lives in a field of its own (`CARET_FIELD`, Tiptap's relative positions), so
 * it never collides with the map cursor.
 */
export type PresenceUser = { id: string; name: string; colour: string };
export type MapCursor = { lat: number; lng: number };
export type PresenceState = {
  user: PresenceUser;
  /** The place or day this person is editing (its editor or note is open). */
  editing: string | null;
  cursor: MapCursor | null;
};
/** Another person here now, as seen through one of their connections. */
export type Peer = PresenceState & { clientId: number };

/** The awareness field the note editor's carets use. */
export const CARET_FIELD = "caret";
/** Map cursor updates go out at most every 50 ms (20 Hz). */
export const MAP_CURSOR_MS = 50;

/** Publishes who this connection is (starting with nothing being edited and no map cursor). */
export function setUser(awareness: Awareness, user: PresenceUser): void {
  awareness.setLocalState({ editing: null, cursor: null, ...awareness.getLocalState(), user });
}

export function setEditing(awareness: Awareness, id: string | null): void {
  awareness.setLocalStateField("editing", id);
}

type Throttle = { last: number; timer: ReturnType<typeof setTimeout> | null; next: MapCursor | null };
const throttles = new WeakMap<Awareness, Throttle>();

/**
 * Publishes the map cursor (null when the pointer leaves the map), at most once per `MAP_CURSOR_MS`:
 * the first move goes out at once, moves within the window collapse into the latest, sent when it ends.
 */
export function setMapCursor(awareness: Awareness, cursor: MapCursor | null): void {
  let throttle = throttles.get(awareness);
  if (!throttle) throttles.set(awareness, (throttle = { last: -Infinity, timer: null, next: null }));
  const t = throttle;
  t.next = cursor;
  if (t.timer !== null) return;
  const flush = () => {
    t.timer = null;
    t.last = Date.now();
    awareness.setLocalStateField("cursor", t.next);
  };
  const wait = t.last + MAP_CURSOR_MS - Date.now();
  if (wait <= 0) flush();
  else t.timer = setTimeout(flush, wait);
}

const isString = (v: unknown): v is string => typeof v === "string";

function readCursor(value: unknown): MapCursor | null {
  if (typeof value !== "object" || value === null) return null;
  const { lat, lng } = value as Record<string, unknown>;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Everyone else here now: one entry per user (not per tab or device), excluding this user. When a
 * person has several connections, the one that published most recently wins.
 */
export function peers(awareness: Awareness, selfUserId: string | null): Peer[] {
  const newest = new Map<string, { peer: Peer; at: number }>();
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const user = (state as { user?: Record<string, unknown> }).user;
    if (!user || !isString(user.id) || user.id === selfUserId) return;
    const at = awareness.meta.get(clientId)?.lastUpdated ?? 0;
    const seen = newest.get(user.id);
    if (seen && seen.at > at) return;
    const editing = (state as { editing?: unknown }).editing;
    newest.set(user.id, {
      at,
      peer: {
        clientId,
        user: { id: user.id, name: isString(user.name) ? user.name : "", colour: isString(user.colour) ? user.colour : "" },
        editing: isString(editing) ? editing : null,
        cursor: readCursor((state as { cursor?: unknown }).cursor),
      },
    });
  });
  return [...newest.values()].map((e) => e.peer);
}

const NO_PEERS: Peer[] = [];

/** An external store of `peers`, for useSyncExternalStore. */
function peersStore(awareness: Awareness | null, selfUserId: string | null) {
  let current = awareness ? peers(awareness, selfUserId) : NO_PEERS;
  return {
    subscribe(changed: () => void) {
      if (!awareness) return () => undefined;
      const update = () => {
        current = peers(awareness, selfUserId);
        changed();
      };
      update();
      awareness.on("change", update);
      return () => awareness.off("change", update);
    },
    get: () => current,
  };
}

/** `peers`, kept current as presence changes. */
export function usePeers(awareness: Awareness | null, selfUserId: string | null): Peer[] {
  const store = useMemo(() => peersStore(awareness, selfUserId), [awareness, selfUserId]);
  return useSyncExternalStore(store.subscribe, store.get, () => NO_PEERS);
}

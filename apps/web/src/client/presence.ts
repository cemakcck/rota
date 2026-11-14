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
  if (!throttle) {
    throttles.set(awareness, (throttle = { last: -Infinity, timer: null, next: null }));
    // A move still waiting when presence ends must not fire on a destroyed awareness.
    awareness.once("destroy", () => dropThrottle(awareness));
  }
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

function dropThrottle(awareness: Awareness): void {
  const t = throttles.get(awareness);
  if (t?.timer != null) clearTimeout(t.timer);
  throttles.delete(awareness);
}

/** The map is gone (unmounted): any pending move is dropped and the cursor cleared at once. */
export function stopMapCursor(awareness: Awareness): void {
  dropThrottle(awareness);
  if (awareness.getLocalState()?.cursor) awareness.setLocalStateField("cursor", null);
}

const isString = (v: unknown): v is string => typeof v === "string";

function readCursor(value: unknown): MapCursor | null {
  if (typeof value !== "object" || value === null) return null;
  const { lat, lng } = value as Record<string, unknown>;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Everyone else here now: one entry per user (not per tab or device), excluding this user. When a
 * person has several connections, the one that published most recently gives the name and map
 * cursor; what they are editing comes from the newest connection that is editing something, so an
 * idle second tab (whose presence renews every ~15 s) does not hide it.
 */
export function peers(awareness: Awareness, selfUserId: string | null): Peer[] {
  const people = new Map<string, { peer: Peer; at: number; editingAt: number }>();
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const user = (state as { user?: Record<string, unknown> }).user;
    if (!user || !isString(user.id) || user.id === selfUserId) return;
    const at = awareness.meta.get(clientId)?.lastUpdated ?? 0;
    const raw = (state as { editing?: unknown }).editing;
    const editing = isString(raw) ? raw : null;
    const seen = people.get(user.id);
    const entry = seen ?? { peer: { clientId, user: { id: user.id, name: "", colour: "" }, editing: null, cursor: null }, at: -Infinity, editingAt: -Infinity };
    if (at >= entry.at) {
      entry.at = at;
      entry.peer = {
        ...entry.peer,
        clientId,
        user: { id: user.id, name: isString(user.name) ? user.name : "", colour: isString(user.colour) ? user.colour : "" },
        cursor: readCursor((state as { cursor?: unknown }).cursor),
      };
    }
    if (editing !== null && at >= entry.editingAt) {
      entry.editingAt = at;
      entry.peer = { ...entry.peer, editing };
    }
    people.set(user.id, entry);
  });
  return [...people.values()].map((e) => e.peer);
}

const NO_PEERS: Peer[] = [];

const sameUser = (a: PresenceUser, b: PresenceUser) => a.id === b.id && a.name === b.name && a.colour === b.colour;
const sameCursor = (a: MapCursor | null, b: MapCursor | null) => a === b || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng);

/**
 * An external store of `peers`, for useSyncExternalStore. It hands out the same array until something
 * its readers see changes, so carets (and, without `cursors`, map cursors) never re-render them.
 */
function peersStore(awareness: Awareness | null, selfUserId: string | null, cursors: boolean) {
  const read = (): Peer[] => (awareness ? peers(awareness, selfUserId).map((p) => (cursors ? p : { ...p, cursor: null })) : NO_PEERS);
  const same = (a: Peer[], b: Peer[]) =>
    a.length === b.length &&
    a.every((p, i) => sameUser(p.user, b[i].user) && p.editing === b[i].editing && (!cursors || (p.clientId === b[i].clientId && sameCursor(p.cursor, b[i].cursor))));
  let current = read();
  return {
    subscribe(changed: () => void) {
      if (!awareness) return () => undefined;
      const update = () => {
        const next = read();
        if (same(current, next)) return;
        current = next;
        changed();
      };
      update();
      awareness.on("change", update);
      return () => awareness.off("change", update);
    },
    get: () => current,
  };
}

/**
 * `peers`, kept current as presence changes. Pass `{ cursors: false }` when map cursors are not
 * needed: they are left out (null), and their moves (up to 20 Hz per person) do not re-render.
 */
export function usePeers(awareness: Awareness | null, selfUserId: string | null, { cursors = true }: { cursors?: boolean } = {}): Peer[] {
  const store = useMemo(() => peersStore(awareness, selfUserId, cursors), [awareness, selfUserId, cursors]);
  return useSyncExternalStore(store.subscribe, store.get, () => NO_PEERS);
}

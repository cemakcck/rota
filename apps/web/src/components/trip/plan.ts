import type * as Y from "yjs";
import { movePlace, readTrip, setPlaceTime, type Category, type PlaceView, type Slot, type TripView } from "@rota/trip";

/** Where a planned place lives: a day id, or null for Ideas. */
export type ListId = string | null;

/** Drag-and-drop ids: a place row (drop before or after it) and a list (drop at its end). */
export const placeDropId = (id: string) => `place:${id}`;
export const listDropId = (list: ListId) => `list:${list ?? "ideas"}`;

/** The planned lists in screen order: the days, then Ideas. */
export function plannedLists(view: TripView): { id: ListId; places: PlaceView[] }[] {
  return [...view.days.map((d) => ({ id: d.id as ListId, places: d.places })), { id: null, places: view.ideas }];
}

/**
 * Where a dragged place lands when dropped on `overId`. On a row: before it, or after it when moving
 * down within the same list (so the place takes the row's position). On a list or its rail entry: at its end.
 */
export function dropTarget(view: TripView, activeId: string, overId: string): ({ dayId: ListId } & Slot) | null {
  // The rail's entries (a day, Ideas): at the end of that list.
  if (overId === "rail:ideas") return { dayId: null };
  if (overId.startsWith("rail:day:")) {
    // A day removed meanwhile (by someone else, mid-drag) takes nothing.
    const dayId = overId.slice("rail:day:".length);
    return view.days.some((d) => d.id === dayId) ? { dayId } : null;
  }
  if (overId.startsWith("list:")) {
    const key = overId.slice("list:".length);
    return { dayId: key === "ideas" ? null : key };
  }
  const overPlace = overId.slice("place:".length);
  if (overPlace === activeId) return null;
  for (const list of plannedLists(view)) {
    const over = list.places.findIndex((p) => p.id === overPlace);
    if (over < 0) continue;
    const active = list.places.findIndex((p) => p.id === activeId);
    return active >= 0 && active < over ? { dayId: list.id, afterId: overPlace } : { dayId: list.id, beforeId: overPlace };
  }
  return null;
}

/**
 * A move to another list without a slot (Move to…, a drop on a day in the rail or on another day's list):
 * a stop with a set time keeps it and goes to its place by time in that day (ruling F1); an untimed stop
 * goes to the end. One transaction, so one undo step. False when the place or the day is gone.
 */
export function moveKeepingTime(doc: Y.Doc, id: string, dayId: ListId, origin: string): boolean {
  let moved = false;
  doc.transact(() => {
    const time = plannedLists(readTrip(doc)).flatMap((l) => l.places).find((p) => p.id === id)?.time ?? null;
    moved = movePlace(doc, id, { dayId }, origin);
    if (moved && dayId !== null && time !== null) setPlaceTime(doc, id, time, origin);
  }, origin);
  return moved;
}

/**
 * A drop of a dragged place, where `dropTarget` says, as one undo step. Within a day (or onto a row) a
 * timed stop is re-timed for its new slot (spec §2b); dropped on another list as a whole (its rail
 * entry, its end) it keeps its time (see moveKeepingTime). False when the drop lands nowhere (on
 * itself, on a day that is gone).
 */
export function dropPlace(doc: Y.Doc, view: TripView, activeId: string, overId: string, origin: string): boolean {
  const to = dropTarget(view, activeId, overId);
  if (to === null) return false;
  const from = plannedLists(view).find((l) => l.places.some((p) => p.id === activeId))?.id;
  if (to.beforeId == null && to.afterId == null && to.dayId !== from) return moveKeepingTime(doc, activeId, to.dayId, origin);
  return movePlace(doc, activeId, to, origin, { retime: true });
}

export type Filter = { categories: Category[]; tag: string | null };
export const NO_FILTER: Filter = { categories: [], tag: null };

/** Whether a place passes the filter. Tags compare case-insensitively, as normaliseTags dedupes them. */
export function passes(filter: Filter, place: PlaceView): boolean {
  if (filter.categories.length > 0 && !filter.categories.includes(place.category)) return false;
  return filter.tag === null || place.tags.some((t) => t.toLowerCase() === filter.tag);
}

/** The tags used on planned places, first spelling wins, sorted for the locale. */
export function tripTags(view: TripView, locale: string): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const { places } of plannedLists(view)) {
    for (const p of places) for (const tag of p.tags) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
  return [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, locale));
}

export type Change =
  | { kind: "added" | "moved"; place: string; list: ListId; addedBy?: string }
  | { kind: "deleted"; place: string }
  | { kind: "reordered"; list: ListId };

/** What changed structurally in the planned lists between two snapshots: places added, moved, deleted, lists reordered. */
export function structuralChanges(before: TripView, after: TripView): Change[] {
  const where = (view: TripView) => {
    const at = new Map<string, { list: ListId; place: PlaceView }>();
    for (const list of plannedLists(view)) for (const place of list.places) at.set(place.id, { list: list.id, place });
    return at;
  };
  const known = (view: TripView) => new Set([...where(view).keys(), ...view.suggestions.map((p) => p.id), ...view.dismissed.map((p) => p.id)]);
  const [was, now] = [where(before), where(after)];
  const [existed, exists] = [known(before), known(after)];

  const changes: Change[] = [];
  const stayed = new Set<string>();
  for (const [id, { list, place }] of now) {
    const old = was.get(id);
    if (!existed.has(id)) changes.push({ kind: "added", place: place.name, list, addedBy: place.addedBy });
    else if (!old || old.list !== list) changes.push({ kind: "moved", place: place.name, list });
    else stayed.add(id);
  }
  for (const [id, { place }] of was) if (!exists.has(id)) changes.push({ kind: "deleted", place: place.name });

  // A list is reordered when the places that stayed in it are in a different order.
  const order = (view: TripView) => new Map(plannedLists(view).map((l) => [l.id, l.places.filter((p) => stayed.has(p.id)).map((p) => p.id).join()]));
  const [beforeOrder, afterOrder] = [order(before), order(after)];
  for (const [list, ids] of afterOrder) if (beforeOrder.has(list) && beforeOrder.get(list) !== ids) changes.push({ kind: "reordered", list });
  return changes;
}

/** The trip's destination, else the centre of its pinned places (planned and ideas), else null. */
export function tripCentre(view: TripView): { lat: number; lng: number } | null {
  if (view.destination) return { lat: view.destination.lat, lng: view.destination.lng };
  const pins = plannedLists(view).flatMap((l) => l.places.filter((p) => p.lat !== null && p.lng !== null)) as { lat: number; lng: number }[];
  if (pins.length === 0) return null;
  return { lat: pins.reduce((s, p) => s + p.lat, 0) / pins.length, lng: pins.reduce((s, p) => s + p.lng, 0) / pins.length };
}

/**
 * A time as typed: "9:30", "09.30", "0930" or "9" become "09:30"/"09:00"; empty text is "" (no time);
 * anything else (25:00, words) is null.
 */
export function parseTime(text: string): string | null {
  const s = text.trim();
  if (s === "") return "";
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2] ?? "0")];
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

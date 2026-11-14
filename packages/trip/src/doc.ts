import * as Y from "yjs";
import { DEFAULT_STAY_MINUTES, normaliseTags, type Category } from "./categories";
import { newId } from "./ids";
import { keyBetween, keyForSlot } from "./order";
import {
  DEFAULT_START_TIME,
  DEFAULT_TRAVEL_MODE,
  type Destination,
  type Locale,
  type PlaceStatus,
  type TravelMode,
  type TripView,
} from "./schema";
import { readTrip } from "./view";

// Every mutation is one transaction whose origin is the acting user's id, so
// per-person undo (Y.UndoManager trackedOrigins) never reverts a friend's edit.

type YRecord = Y.Map<unknown>;

export type TripMeta = {
  name: string;
  startDate: string;
  destination: Destination | null;
  isDemo: boolean;
  locale: Locale;
};

export type NewPlace = {
  name: string;
  lat?: number | null;
  lng?: number | null;
  osmId?: string | null;
  address?: string | null;
  category: Category;
  tags?: string[];
  stayMinutes?: number;
  dayId: string | null;
  status?: "planned" | "suggested";
};

export type PlacePatch = Partial<{ name: string; category: Category; tags: string[]; stayMinutes: number }>;
export type DayPatch = Partial<{ startTime: string; travelMode: TravelMode }>;
export type ChecklistPatch = Partial<{ text: string; done: boolean; assignee: string | null }>;
/** Neighbours in the target list; null = the open end. Neither given: append. */
export type Slot = { beforeId?: string | null; afterId?: string | null };

const places = (doc: Y.Doc) => doc.getMap<unknown>("places");
const days = (doc: Y.Doc) => doc.getMap<unknown>("days");
const checklist = (doc: Y.Doc) => doc.getMap<unknown>("checklist");
const members = (doc: Y.Doc) => doc.getMap<unknown>("members");

function record(map: Y.Map<unknown>, id: string): YRecord | null {
  const value = map.get(id);
  return value instanceof Y.Map ? (value as YRecord) : null;
}

function maxKey(orders: readonly string[]): string | null {
  let max: string | null = null;
  for (const o of orders) if (max === null || o > max) max = o;
  return max;
}

/** Key after the largest of `orders`. */
function appendKey(orders: readonly string[]): string {
  return keyBetween(maxKey(orders), null);
}

/** Key for `slot` within a list already sorted by compareOrder. */
function slotKey(sorted: readonly { id: string; order: string }[], slot: Slot): string {
  const indexOf = (id: string | null | undefined) => (typeof id === "string" ? sorted.findIndex((x) => x.id === id) : -1);
  const after = indexOf(slot.afterId);
  const before = indexOf(slot.beforeId);
  const at = after >= 0 ? after + 1 : before >= 0 ? before : slot.afterId === null ? 0 : sorted.length;
  const orders = sorted.map((x) => x.order);
  return keyForSlot(orders, orders[at - 1] ?? null, orders[at] ?? null);
}

/** The sorted planned list for `dayId` (null = Ideas); null if that day is gone. */
function plannedList(view: TripView, dayId: string | null) {
  return dayId === null ? view.ideas : (view.days.find((d) => d.id === dayId)?.places ?? null);
}

/** Order keys of the list a place with this status and day shows in. */
function listOrders(view: TripView, status: PlaceStatus, dayId: string | null): string[] {
  if (status === "suggested") return view.suggestions.map((p) => p.order);
  if (status === "dismissed") return view.dismissed.map((p) => p.order);
  return (plannedList(view, dayId) ?? view.ideas).map((p) => p.order);
}

function dayExists(doc: Y.Doc, dayId: string | null): boolean {
  return dayId !== null && record(days(doc), dayId) !== null;
}

function newDay(index: number): YRecord {
  const day = new Y.Map<unknown>();
  day.set("index", index);
  day.set("startTime", DEFAULT_START_TIME);
  day.set("travelMode", DEFAULT_TRAVEL_MODE);
  day.set("note", new Y.XmlFragment());
  return day;
}

export function initTrip(
  doc: Y.Doc,
  input: { name: string; startDate: string; days: number; destination?: Destination | null; isDemo?: boolean; locale: Locale },
  origin: string,
): void {
  doc.transact(() => {
    const meta = doc.getMap<unknown>("meta");
    meta.set("name", input.name);
    meta.set("startDate", input.startDate);
    meta.set("destination", input.destination ?? null);
    meta.set("isDemo", input.isDemo ?? false);
    meta.set("locale", input.locale);
    places(doc);
    checklist(doc);
    members(doc);
    for (let i = 0; i < input.days; i++) days(doc).set(newId(), newDay(i));
  }, origin);
}

export function setTripMeta(doc: Y.Doc, patch: Partial<TripMeta>, origin: string): void {
  doc.transact(() => {
    const meta = doc.getMap<unknown>("meta");
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && meta.get(key) !== value) meta.set(key, value);
    }
  }, origin);
}

/** Appends a day after the last one; returns its id. */
export function addDay(doc: Y.Doc, origin: string): string {
  const id = newId();
  doc.transact(() => {
    let max = -1;
    days(doc).forEach((day) => {
      const index = day instanceof Y.Map ? day.get("index") : null;
      if (typeof index === "number" && Number.isFinite(index)) max = Math.max(max, index);
    });
    days(doc).set(id, newDay(max + 1));
  }, origin);
  return id;
}

/** Removes a day. Its places move to the end of Ideas, in order; none are deleted. */
export function removeDay(doc: Y.Doc, dayId: string, origin: string): void {
  if (!dayExists(doc, dayId)) return;
  doc.transact(() => {
    const view = readTrip(doc);
    const moving = view.days.find((d) => d.id === dayId)?.places ?? [];
    let last = maxKey(view.ideas.map((p) => p.order));
    for (const place of moving) {
      const m = record(places(doc), place.id)!;
      last = keyBetween(last, null);
      m.set("dayId", null);
      m.set("order", last);
    }
    // Suggestions and dismissed places aimed at this day keep their lists but lose the day.
    places(doc).forEach((value) => {
      if (value instanceof Y.Map && value.get("dayId") === dayId) value.set("dayId", null);
    });
    days(doc).delete(dayId);
  }, origin);
}

export function setDay(doc: Y.Doc, dayId: string, patch: DayPatch, origin: string): void {
  const day = record(days(doc), dayId);
  if (!day) return;
  doc.transact(() => {
    if (patch.startTime !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.startTime)) {
      day.set("startTime", patch.startTime);
    }
    if (patch.travelMode === "walk" || patch.travelMode === "drive") day.set("travelMode", patch.travelMode);
  }, origin);
}

/** Adds a place at the end of its list (a day, Ideas, or Suggestions); returns its id. */
export function addPlace(doc: Y.Doc, input: NewPlace, origin: string): string {
  const id = newId();
  const status = input.status ?? "planned";
  // A planned place for a day that no longer exists goes to Ideas.
  const dayId = status === "planned" && !dayExists(doc, input.dayId) ? null : input.dayId;
  doc.transact(() => {
    const place = new Y.Map<unknown>();
    place.set("name", input.name);
    place.set("lat", input.lat ?? null);
    place.set("lng", input.lng ?? null);
    place.set("osmId", input.osmId ?? null);
    place.set("address", input.address ?? null);
    place.set("category", input.category);
    place.set("tags", normaliseTags(input.tags ?? []));
    place.set("stayMinutes", input.stayMinutes ?? DEFAULT_STAY_MINUTES[input.category]);
    place.set("dayId", dayId);
    place.set("order", appendKey(listOrders(readTrip(doc), status, dayId)));
    place.set("addedBy", origin);
    place.set("createdAt", Date.now());
    place.set("status", status);
    place.set("votes", new Y.Map<unknown>());
    place.set("note", new Y.XmlFragment());
    places(doc).set(id, place);
  }, origin);
  return id;
}

export function updatePlace(doc: Y.Doc, id: string, patch: PlacePatch, origin: string): void {
  const place = record(places(doc), id);
  if (!place) return;
  doc.transact(() => {
    if (patch.name !== undefined) place.set("name", patch.name);
    if (patch.category !== undefined) place.set("category", patch.category);
    if (patch.tags !== undefined) place.set("tags", normaliseTags(patch.tags));
    if (patch.stayMinutes !== undefined && Number.isFinite(patch.stayMinutes)) {
      place.set("stayMinutes", Math.max(0, Math.round(patch.stayMinutes)));
    }
  }, origin);
}

/**
 * Moves a place to a day (or Ideas when `dayId` is null) next to the given
 * neighbours. Writes only `dayId` and `order`, so concurrent moves resolve to
 * one winner instead of duplicating. Returns false, changing nothing, if the
 * place or the target day is gone.
 */
export function movePlace(
  doc: Y.Doc,
  id: string,
  to: { dayId: string | null } & Slot,
  origin: string,
): boolean {
  const place = record(places(doc), id);
  const list = plannedList(readTrip(doc), to.dayId);
  if (!place || !list) return false;
  doc.transact(() => {
    place.set("dayId", to.dayId);
    place.set("order", slotKey(list.filter((p) => p.id !== id), to));
  }, origin);
  return true;
}

export function deletePlace(doc: Y.Doc, id: string, origin: string): void {
  if (!record(places(doc), id)) return;
  doc.transact(() => places(doc).delete(id), origin);
}

/** Changes status (accept, dismiss, restore); the place goes to the end of its new list. */
export function setPlaceStatus(doc: Y.Doc, id: string, status: PlaceStatus, origin: string): void {
  const place = record(places(doc), id);
  if (!place || place.get("status") === status) return;
  doc.transact(() => {
    let dayId = (place.get("dayId") as string | null | undefined) ?? null;
    if (status === "planned" && !dayExists(doc, dayId)) dayId = null;
    place.set("status", status);
    place.set("dayId", dayId);
    place.set("order", appendKey(listOrders(readTrip(doc), status, dayId)));
  }, origin);
}

/** One vote per user per place: 1 or -1 sets it, 0 withdraws it. */
export function vote(doc: Y.Doc, placeId: string, userId: string, value: 1 | -1 | 0): void {
  const place = record(places(doc), placeId);
  if (!place) return;
  doc.transact(() => {
    let votes = place.get("votes");
    if (!(votes instanceof Y.Map)) {
      votes = new Y.Map<unknown>();
      place.set("votes", votes);
    }
    const map = votes as Y.Map<unknown>;
    if (value === 0) map.delete(userId);
    else if (map.get(userId) !== value) map.set(userId, value);
  }, userId);
}

function note(map: Y.Map<unknown>, id: string, kind: string): Y.XmlFragment {
  const fragment = record(map, id)?.get("note");
  if (!(fragment instanceof Y.XmlFragment)) throw new Error(`${kind} ${id} has no note`);
  return fragment;
}

/** The place's collaborative note (Tiptap binds to it). Throws if the place is gone. */
export function placeNote(doc: Y.Doc, id: string): Y.XmlFragment {
  return note(places(doc), id, "Place");
}

/** The day's collaborative note. Throws if the day is gone. */
export function dayNote(doc: Y.Doc, id: string): Y.XmlFragment {
  return note(days(doc), id, "Day");
}

/** Appends a checklist item; returns its id. */
export function addChecklistItem(doc: Y.Doc, text: string, origin: string): string {
  const id = newId();
  doc.transact(() => {
    const item = new Y.Map<unknown>();
    item.set("text", text);
    item.set("done", false);
    item.set("assignee", null);
    item.set("order", appendKey(readTrip(doc).checklist.map((i) => i.order)));
    checklist(doc).set(id, item);
  }, origin);
  return id;
}

export function updateChecklistItem(doc: Y.Doc, id: string, patch: ChecklistPatch, origin: string): void {
  const item = record(checklist(doc), id);
  if (!item) return;
  doc.transact(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && item.get(key) !== value) item.set(key, value);
    }
  }, origin);
}

/** Moves a checklist item next to the given neighbours; false, changing nothing, if it is gone. */
export function moveChecklistItem(doc: Y.Doc, id: string, to: Slot, origin: string): boolean {
  const item = record(checklist(doc), id);
  if (!item) return false;
  const list = readTrip(doc).checklist.filter((i) => i.id !== id);
  doc.transact(() => item.set("order", slotKey(list, to)), origin);
  return true;
}

export function deleteChecklistItem(doc: Y.Doc, id: string, origin: string): void {
  if (!record(checklist(doc), id)) return;
  doc.transact(() => checklist(doc).delete(id), origin);
}

/** Mirrors a member's display name and colour (access control lives in the database). */
export function upsertMember(doc: Y.Doc, member: { id: string; name: string; colour: string }): void {
  doc.transact(() => {
    let m = record(members(doc), member.id);
    if (!m) {
      m = new Y.Map<unknown>();
      members(doc).set(member.id, m);
    }
    if (m.get("name") !== member.name) m.set("name", member.name);
    if (m.get("colour") !== member.colour) m.set("colour", member.colour);
  });
}

export function removeMember(doc: Y.Doc, id: string): void {
  if (!record(members(doc), id)) return;
  doc.transact(() => members(doc).delete(id));
}

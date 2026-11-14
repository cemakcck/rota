import * as Y from "yjs";
import { DEFAULT_STAY_MINUTES, normaliseTags, type Category } from "./categories";
import { newId } from "./ids";
import { keyBetween, planSlot } from "./order";
import {
  DEFAULT_TRAVEL_MODE,
  dayTitle,
  isTime,
  type DayView,
  type Destination,
  type Locale,
  type PlaceStatus,
  type PlaceView,
  type TravelMode,
  type TripView,
} from "./schema";
import { suggestTime } from "./timeline";
import { estimateLeg, type Leg } from "./travel";
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
  /** "HH:MM" the stop starts; a planned stop with a time goes to its chronological place in the day. */
  time?: string | null;
  dayId: string | null;
  status?: "planned" | "suggested";
};

export type PlacePatch = Partial<{ name: string; category: Category; tags: string[]; stayMinutes: number }>;
/** `title` is trimmed and cut to DAY_TITLE_MAX characters (code points); "" clears it. */
export type DayPatch = Partial<{ travelMode: TravelMode; title: string }>;
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

/**
 * Order key for `slot` within `sorted` (a list sorted by compareOrder, without
 * the item being placed). Call inside a transaction: tied neighbours in
 * `container` may be given fresh keys so the item lands exactly where asked.
 */
function slotKey(container: Y.Map<unknown>, sorted: readonly { id: string; order: string }[], slot: Slot): string {
  const indexOf = (id: string | null | undefined) => (typeof id === "string" ? sorted.findIndex((x) => x.id === id) : -1);
  const after = indexOf(slot.afterId);
  const before = indexOf(slot.beforeId);
  const at = after >= 0 ? after + 1 : before >= 0 ? before : slot.afterId === null ? 0 : sorted.length;
  return keyAt(container, sorted, at);
}

/** Order key for position `at` of `sorted`; tied neighbours get fresh keys (call inside a transaction). */
function keyAt(container: Y.Map<unknown>, sorted: readonly { id: string; order: string }[], at: number): string {
  const { key, rekey } = planSlot(sorted, at);
  for (const { id, order } of rekey) record(container, id)?.set("order", order);
  return key;
}

/**
 * Where a stop at `time` belongs in `others` (a day's stops, sorted, without it), given that it
 * would otherwise sit at position `current`: after the last stop timed at or before `time` and no
 * later than the first stop timed after it. Already in that range, it stays (so the untimed stops
 * around it keep their relative order); otherwise it goes right after the earlier timed stop, or
 * right before the later one when none is earlier.
 */
function chronologicalIndex(others: readonly PlaceView[], time: string, current: number): number {
  let lo = 0;
  let hi = others.length;
  others.forEach((p, i) => {
    if (p.time === null) return;
    if (p.time <= time) lo = i + 1;
    else if (hi === others.length) hi = i;
  });
  if (lo <= current && current <= hi) return current;
  return lo > 0 ? lo : hi;
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

/**
 * Moves a day to position `toIndex` (0-based, clamped to the trip) among the days; the dates follow the
 * new order (day N is startDate + N − 1), and its places, title and note go with it. Writes only the
 * day's `index`, a number between its new neighbours' (so a friend's concurrent move of another day,
 * or any place edit, merges with it); only when no number fits between them (tied indexes from
 * concurrent adds, or exhausted precision) are all days renumbered 0..n−1 in the new order, in the same
 * transaction. Returns false, changing nothing (no transaction), for an unknown day, a position that is
 * not a number, or the position it already has.
 *
 * Concurrency: the usual single-key write merges with anything a friend does. The renumbering fallback
 * writes every day's `index`, each last-write-wins: if a friend moves another day at the same moment,
 * one of the two writes to that day's `index` wins, so their move can be lost (or land in a mixed
 * order). Every device still converges to the same order (readTrip sorts by index then id) and no day
 * or place is lost; it needs tied indexes or exhausted precision, so it is rare.
 */
export function moveDay(doc: Y.Doc, dayId: string, toIndex: number, origin: string): boolean {
  const sorted = readTrip(doc).days.map((d) => d.id);
  const from = sorted.indexOf(dayId);
  if (from < 0 || !Number.isFinite(toIndex)) return false;
  const to = Math.min(sorted.length - 1, Math.max(0, Math.round(toIndex)));
  if (to === from) return false;
  const others = sorted.filter((id) => id !== dayId);
  const stored = (id: string | undefined) => {
    const index = id === undefined ? undefined : record(days(doc), id)?.get("index");
    return typeof index === "number" && Number.isFinite(index) ? index : null;
  };
  const [prevId, nextId] = [others[to - 1], others[to]];
  const [prev, next] = [stored(prevId), stored(nextId)];
  let index: number | null = null;
  // A neighbour with no usable index sorts last: renumber rather than guess.
  if ((prevId === undefined || prev !== null) && (nextId === undefined || next !== null)) {
    const candidate = prev === null ? next! - 1 : next === null ? prev + 1 : (prev + next) / 2;
    if (Number.isFinite(candidate) && (prev === null || candidate > prev) && (next === null || candidate < next)) index = candidate;
  }
  doc.transact(() => {
    if (index !== null) return void record(days(doc), dayId)?.set("index", index);
    others.splice(to, 0, dayId);
    others.forEach((id, i) => {
      const day = record(days(doc), id);
      if (day && day.get("index") !== i) day.set("index", i);
    });
  }, origin);
  return true;
}

export function setDay(doc: Y.Doc, dayId: string, patch: DayPatch, origin: string): void {
  const day = record(days(doc), dayId);
  if (!day) return;
  doc.transact(() => {
    if (patch.travelMode === "walk" || patch.travelMode === "drive") day.set("travelMode", patch.travelMode);
    if (typeof patch.title === "string") {
      const title = dayTitle(patch.title);
      if (day.get("title") !== title) day.set("title", title);
    }
  }, origin);
}

/**
 * Adds a place at the end of its list (a day, Ideas, or Suggestions); returns
 * its id. A planned stop with a time goes to its chronological place in the
 * day instead (see setPlaceTime). The name is trimmed; a blank name or a time
 * that is not "HH:MM" throws.
 */
export function addPlace(doc: Y.Doc, input: NewPlace, origin: string): string {
  const name = input.name.trim();
  if (!name) throw new Error("A place needs a name");
  const time = input.time ?? null;
  if (time !== null && !isTime(time)) throw new Error("A time is HH:MM");
  const id = newId();
  const status = input.status ?? "planned";
  // A planned place for a day that no longer exists goes to Ideas.
  const dayId = status === "planned" && !dayExists(doc, input.dayId) ? null : input.dayId;
  doc.transact(() => {
    const place = new Y.Map<unknown>();
    place.set("name", name);
    place.set("lat", input.lat ?? null);
    place.set("lng", input.lng ?? null);
    place.set("osmId", input.osmId ?? null);
    place.set("address", input.address ?? null);
    place.set("category", input.category);
    place.set("tags", normaliseTags(input.tags ?? []));
    place.set("stayMinutes", input.stayMinutes ?? DEFAULT_STAY_MINUTES[input.category]);
    place.set("time", time);
    place.set("dayId", dayId);
    const view = readTrip(doc);
    const day = status === "planned" && dayId !== null ? plannedList(view, dayId) : null;
    place.set(
      "order",
      day && time !== null
        ? keyAt(places(doc), day, chronologicalIndex(day, time, day.length))
        : appendKey(listOrders(view, status, dayId)),
    );
    place.set("addedBy", origin);
    place.set("createdAt", Date.now());
    place.set("status", status);
    place.set("votes", new Y.Map<unknown>());
    place.set("note", new Y.XmlFragment());
    places(doc).set(id, place);
  }, origin);
  return id;
}

/** Edits a place. A blank name is ignored (the rest of the patch still applies). */
export function updatePlace(doc: Y.Doc, id: string, patch: PlacePatch, origin: string): void {
  const place = record(places(doc), id);
  if (!place) return;
  doc.transact(() => {
    const name = patch.name?.trim();
    if (name) place.set("name", name);
    if (patch.category !== undefined) place.set("category", patch.category);
    if (patch.tags !== undefined) place.set("tags", normaliseTags(patch.tags));
    if (patch.stayMinutes !== undefined && Number.isFinite(patch.stayMinutes)) {
      place.set("stayMinutes", Math.max(0, Math.round(patch.stayMinutes)));
    }
  }, origin);
}

/**
 * Sets (or with null clears) the time a place starts. A planned stop given a
 * time also moves to its chronological place among the day's timed stops
 * (writing only its `order`, plus fresh keys for tied neighbours); untimed
 * stops keep their order. Returns false, changing nothing, if the time is not
 * "HH:MM" (00:00–23:59) or the place is gone.
 */
export function setPlaceTime(doc: Y.Doc, id: string, time: string | null, origin: string): boolean {
  const place = record(places(doc), id);
  if (!place || (time !== null && !isTime(time))) return false;
  doc.transact(() => {
    place.set("time", time);
    if (time === null) return;
    const view = readTrip(doc);
    const current = view.days.find((d) => d.places.some((p) => p.id === id))?.places;
    if (!current) return;
    const at = current.findIndex((p) => p.id === id);
    const others = current.filter((p) => p.id !== id);
    const to = chronologicalIndex(others, time, at);
    if (to !== at) place.set("order", keyAt(places(doc), others, to));
  }, origin);
  return true;
}

/** The last minute of the day, 23:59: a shifted time never goes past it (nor before 00:00). */
const LAST_MINUTE = 24 * 60 - 1;

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/**
 * Moves every set time in a day by `minutes` (rounded to whole minutes), in one transaction, so it is
 * one undo step. Untimed stops are untouched. A time that would go before 00:00 or past 23:59 stops
 * there; those places' ids are returned in `clamped`, in the day's order. The timed stops are then put
 * back in chronological order the way setPlaceTime does (only `order`s are written; untimed stops keep
 * their places). Nothing is written (no transaction, no undo step) for an unknown day, 0 minutes, a
 * day without set times, or when no time would change (all already at the limit); `clamped` still
 * says which stops are held there.
 *
 * Concurrency: each stop's new time is written as an absolute "HH:MM", so like every other field it is
 * last-write-wins. Two members shifting the same day at once give one shift, not two; a stop a friend
 * re-timed meanwhile keeps whichever write wins, and a stop they added meanwhile is not shifted. The
 * merged day is not re-sorted, so its timed stops can be out of chronological order until the next
 * local time edit or shift (setPlaceTime merges the same way). Nothing is ever lost, and readTrip reads
 * any such merge.
 */
export function shiftDayTimes(doc: Y.Doc, dayId: string, minutes: number, origin: string): { clamped: string[] } {
  const clamped: string[] = [];
  const by = Math.round(minutes);
  const timed = readTrip(doc).days.find((d) => d.id === dayId)?.places.filter((p) => p.time !== null) ?? [];
  if (!Number.isFinite(by) || by === 0 || timed.length === 0) return { clamped };
  const next = timed.map((p) => {
    const wanted = toMinutes(p.time!) + by;
    const total = Math.min(LAST_MINUTE, Math.max(0, wanted));
    if (total !== wanted) clamped.push(p.id);
    return { id: p.id, time: toTime(total), changed: toTime(total) !== p.time };
  });
  if (!next.some((p) => p.changed)) return { clamped };
  doc.transact(() => {
    for (const p of next) if (p.changed) record(places(doc), p.id)?.set("time", p.time);
    // Shifting keeps the order of times, but a stop out of order beforehand (concurrent edits) is put
    // in its place, one at a time, as setPlaceTime would.
    for (const { id } of timed) {
      const current = readTrip(doc).days.find((d) => d.id === dayId)?.places ?? [];
      const at = current.findIndex((p) => p.id === id);
      const time = current[at]?.time;
      if (at < 0 || !time) continue;
      const others = current.filter((p) => p.id !== id);
      const to = chronologicalIndex(others, time, at);
      if (to !== at) record(places(doc), id)?.set("order", keyAt(places(doc), others, to));
    }
  }, origin);
  return { clamped };
}

/**
 * Origin for migrateDayStart when run on load: no user's undo tracks it, so
 * nobody's Ctrl+Z brings a day start time back.
 */
export const MIGRATION_ORIGIN = "migration";

/** The start time every day got before times were set per stop; never chosen by anyone, so not kept. */
const LEGACY_DEFAULT_START = "09:00";

/**
 * Moves the start time of days written before times were set per stop onto
 * each day's first stop, when that stop has no time of its own, then deletes
 * it. The untouched 09:00 default is deleted without setting a time. Writes
 * nothing (no transaction) when there is nothing left to move, so calling it
 * on every load is cheap.
 */
export function migrateDayStart(doc: Y.Doc, origin: string): void {
  const legacy: [string, YRecord][] = [];
  days(doc).forEach((day, id) => {
    if (day instanceof Y.Map && day.has("startTime")) legacy.push([id, day as YRecord]);
  });
  if (legacy.length === 0) return;
  doc.transact(() => {
    const view = readTrip(doc);
    for (const [id, day] of legacy) {
      const start = day.get("startTime");
      const first = view.days.find((d) => d.id === id)?.places[0];
      if (first && first.time === null && isTime(start) && start !== LEGACY_DEFAULT_START) record(places(doc), first.id)?.set("time", start);
      day.delete("startTime");
    }
  }, origin);
}

/** Straight-line legs between a day's consecutive stops (null where a stop has no pin). */
function estimatedLegs(day: DayView): (Leg | null)[] {
  return day.places.slice(1).map((next, i) => {
    const prev = day.places[i];
    if (prev.lat === null || prev.lng === null || next.lat === null || next.lng === null) return null;
    return estimateLeg({ lat: prev.lat, lng: prev.lng }, { lat: next.lat, lng: next.lng }, day.travelMode);
  });
}

/**
 * The time for a timed stop dropped at `index` of `day` (which already holds it there): the
 * suggested time for that slot, or its old time when there is no suggestion, clamped between the
 * timed stops before and after it so the order and the times never disagree.
 */
function retimeFor(day: DayView, index: number, old: string): string {
  let time = suggestTime(day, estimatedLegs(day), index) ?? old;
  const before = day.places.slice(0, index).findLast((p) => p.time !== null)?.time ?? null;
  const after = day.places.slice(index + 1).find((p) => p.time !== null)?.time ?? null;
  if (after !== null && time > after) time = after;
  if (before !== null && time < before) time = before;
  return time;
}

/**
 * Moves a place to a day (or Ideas when `dayId` is null) next to the given
 * neighbours. Writes only the place's `dayId` and `order` (plus fresh `order`s
 * for neighbours whose keys tie at the drop point), so concurrent moves
 * resolve to one winner instead of duplicating. Returns false, changing nothing, if the
 * place or the target day is gone.
 *
 * With `retime` (a drag in the UI), a timed stop dropped in a day keeps the
 * dropped position and gets the time suggested for its new slot (previous
 * stop's end + estimated travel; its old time when nothing timed comes
 * before), clamped between the neighbouring timed stops; an untimed stop stays
 * untimed. All in the same transaction, so it is one undo step.
 */
export function movePlace(
  doc: Y.Doc,
  id: string,
  to: { dayId: string | null } & Slot,
  origin: string,
  options: { retime?: boolean } = {},
): boolean {
  const place = record(places(doc), id);
  const list = plannedList(readTrip(doc), to.dayId);
  if (!place || !list) return false;
  doc.transact(() => {
    place.set("dayId", to.dayId);
    place.set("order", slotKey(places(doc), list.filter((p) => p.id !== id), to));
    if (!options.retime || to.dayId === null) return;
    const day = readTrip(doc).days.find((d) => d.id === to.dayId);
    const index = day?.places.findIndex((p) => p.id === id) ?? -1;
    const old = day?.places[index]?.time ?? null;
    if (!day || old === null) return;
    const time = retimeFor(day, index, old);
    if (time !== old) place.set("time", time);
  }, origin);
  return true;
}

/**
 * Deletes a place. A Y.Map delete alone writes nothing under the deleter's client id (the delete set
 * names the deleted items' authors), so the place is first stamped `deletedBy`: the update then carries
 * the deleter's client, and peers can say who deleted it.
 */
export function deletePlace(doc: Y.Doc, id: string, origin: string): void {
  const place = record(places(doc), id);
  if (!place) return;
  doc.transact(() => {
    place.set("deletedBy", origin);
    places(doc).delete(id);
  }, origin);
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
  doc.transact(() => item.set("order", slotKey(checklist(doc), list, to)), origin);
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

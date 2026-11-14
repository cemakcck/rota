import * as Y from "yjs";
import { DEFAULT_STAY_MINUTES, isCategory, normaliseTags } from "./categories";
import { compareOrder, isOrderKey } from "./order";
import {
  DEFAULT_START_TIME,
  DEFAULT_TRAVEL_MODE,
  type ChecklistItemView,
  type DayView,
  type Destination,
  type MemberView,
  type PlaceStatus,
  type PlaceView,
  type TripView,
} from "./schema";

type YRecord = Y.Map<unknown>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Entries of a Y.Map whose values are nested Y.Maps; anything else a peer wrote is ignored. */
function records(map: Y.Map<unknown>): [string, YRecord][] {
  const out: [string, YRecord][] = [];
  map.forEach((value, key) => {
    if (value instanceof Y.Map) out.push([key, value as YRecord]);
  });
  return out;
}

// Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's algorithm), no Date involved.
function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): string {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `date` (YYYY-MM-DD) plus `days`, as pure calendar arithmetic. "" if `date` is not a date. */
export function addDaysToDate(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "";
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  return civilFromDays(daysFromCivil(y, m, d) + days);
}

function readDestination(value: unknown): Destination | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, lat, lng } = value as Record<string, unknown>;
  if (typeof name !== "string" || !finite(lat) || !finite(lng)) return null;
  return { name, lat, lng };
}

function readVotes(value: unknown): Record<string, 1 | -1> {
  const votes: Record<string, 1 | -1> = {};
  if (value instanceof Y.Map) {
    value.forEach((v, userId) => {
      if (v === 1 || v === -1) votes[userId] = v;
    });
  }
  return votes;
}

/** A place, or null if it is too malformed to show. */
function readPlace(id: string, m: YRecord): PlaceView | null {
  const name = m.get("name");
  if (typeof name !== "string" || !name.trim()) return null;
  const lat = m.get("lat") ?? null;
  const lng = m.get("lng") ?? null;
  const unpinned = lat === null && lng === null;
  if (!unpinned && !(finite(lat) && finite(lng))) return null;
  const order = m.get("order");
  if (!isOrderKey(order)) return null;

  const rawCategory = m.get("category");
  const category = isCategory(rawCategory) ? rawCategory : "other";
  const rawTags = m.get("tags");
  const stayMinutes = m.get("stayMinutes");
  const createdAt = m.get("createdAt");
  const rawStatus = m.get("status");
  const status: PlaceStatus = rawStatus === "suggested" || rawStatus === "dismissed" ? rawStatus : "planned";
  const votes = readVotes(m.get("votes"));
  return {
    id,
    name,
    lat: unpinned ? null : (lat as number),
    lng: unpinned ? null : (lng as number),
    osmId: str(m.get("osmId")),
    address: str(m.get("address")),
    category,
    tags: Array.isArray(rawTags) ? normaliseTags(rawTags) : [],
    stayMinutes: finite(stayMinutes) && stayMinutes >= 0 ? stayMinutes : DEFAULT_STAY_MINUTES[category],
    dayId: str(m.get("dayId")),
    order,
    addedBy: str(m.get("addedBy")) ?? "",
    createdAt: finite(createdAt) ? createdAt : 0,
    status,
    votes,
    score: Object.values(votes).reduce<number>((sum, v) => sum + v, 0),
  };
}

function readChecklistItem(id: string, m: YRecord): ChecklistItemView | null {
  const text = m.get("text");
  const order = m.get("order");
  if (typeof text !== "string" || !isOrderKey(order)) return null;
  return { id, text, done: m.get("done") === true, assignee: str(m.get("assignee")), order };
}

/** Days sorted by stored index then id, positioned 0..n-1 (ties from concurrent adds stay consecutive). */
function sortedDays(doc: Y.Doc): [string, YRecord][] {
  const rank = (m: YRecord) => {
    const index = m.get("index");
    return finite(index) ? index : Number.MAX_SAFE_INTEGER;
  };
  return records(doc.getMap("days")).sort(
    ([idA, a], [idB, b]) => rank(a) - rank(b) || (idA < idB ? -1 : idA > idB ? 1 : 0),
  );
}

/** A plain snapshot of the trip. Never throws: malformed entries are skipped or defaulted. */
export function readTrip(doc: Y.Doc): TripView {
  const meta = doc.getMap<unknown>("meta");
  const startDate = str(meta.get("startDate")) ?? "";

  const places: PlaceView[] = [];
  for (const [id, m] of records(doc.getMap("places"))) {
    const place = readPlace(id, m);
    if (place) places.push(place);
  }

  const days: DayView[] = sortedDays(doc).map(([id, m], index) => {
    const startTime = m.get("startTime");
    return {
      id,
      index,
      date: addDaysToDate(startDate, index),
      startTime: typeof startTime === "string" && TIME.test(startTime) ? startTime : DEFAULT_START_TIME,
      travelMode: m.get("travelMode") === "drive" ? "drive" : DEFAULT_TRAVEL_MODE,
      places: [],
    };
  });
  const dayById = new Map(days.map((d) => [d.id, d]));

  const ideas: PlaceView[] = [];
  const suggestions: PlaceView[] = [];
  const dismissed: PlaceView[] = [];
  for (const place of places) {
    if (place.status === "suggested") suggestions.push(place);
    else if (place.status === "dismissed") dismissed.push(place);
    // A planned place whose day is gone (e.g. added while someone removed the day) is an idea.
    else {
      const day = place.dayId === null ? undefined : dayById.get(place.dayId);
      (day ? day.places : ideas).push(place);
    }
  }
  for (const day of days) day.places.sort(compareOrder);
  ideas.sort(compareOrder);
  dismissed.sort(compareOrder);
  // Suggestions: by score, then newest (spec §5.1), then id for a stable tie-break.
  suggestions.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt || compareOrder(a, b));

  const checklist: ChecklistItemView[] = [];
  for (const [id, m] of records(doc.getMap("checklist"))) {
    const item = readChecklistItem(id, m);
    if (item) checklist.push(item);
  }
  checklist.sort(compareOrder);

  const members: MemberView[] = [];
  for (const [id, m] of records(doc.getMap("members"))) {
    const name = m.get("name");
    if (typeof name === "string") members.push({ id, name, colour: str(m.get("colour")) ?? "" });
  }
  members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    name: str(meta.get("name")) ?? "",
    startDate,
    destination: readDestination(meta.get("destination")),
    isDemo: meta.get("isDemo") === true,
    locale: meta.get("locale") === "tr" ? "tr" : "en",
    days,
    ideas,
    suggestions,
    dismissed,
    checklist,
    members,
    placeCount: places.length,
  };
}

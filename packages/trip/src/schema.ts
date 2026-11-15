import type { Category } from "./categories";

/**
 * Document layout. Top-level shares are exactly these five (the sync server
 * rejects anything else):
 * - meta: Y.Map { name, startDate, destination, isDemo, locale }
 * - places: Y.Map<placeId, Y.Map { name, lat, lng, osmId, address, category, tags,
 *     stayMinutes, time ("HH:MM" or null = untimed), dayId, order, addedBy, createdAt, status, votes: Y.Map<userId, 1 | -1>,
 *     note: Y.XmlFragment, deletedBy (set just before the place is deleted, see deletePlace) }>
 * - days: Y.Map<dayId, Y.Map { index (a number: days sort by it, then id; not always an integer, see moveDay), travelMode, title (≤ DAY_TITLE_MAX chars, "" = none), note: Y.XmlFragment }> (legacy days may
 *     still hold `startTime`; it is never read, and migrateDayStart moves it onto the first stop)
 * - checklist: Y.Map<itemId, Y.Map { text, done, assignee, order }>
 * - members: Y.Map<userId, Y.Map { name, colour }>
 *
 * Order within a list is a fractional index on each item (`order`, plus `dayId`
 * for places), never an array position, so concurrent moves cannot duplicate.
 */
export const SHARES = ["meta", "places", "days", "checklist", "members"] as const;

export type PlaceStatus = "planned" | "suggested" | "dismissed";
export type TravelMode = "walk" | "drive";
export type Locale = "en" | "tr";
export type Destination = { name: string; lat: number; lng: number };

export type PlaceView = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  osmId: string | null;
  address: string | null;
  category: Category;
  tags: string[];
  stayMinutes: number;
  /** "HH:MM" wall-clock time you arrive / it starts, set by someone; null = untimed. */
  time: string | null;
  dayId: string | null;
  order: string;
  addedBy: string;
  createdAt: number;
  status: PlaceStatus;
  votes: Record<string, 1 | -1>;
  score: number;
};

export type DayView = {
  id: string;
  /** Position among the trip's days, 0-based. */
  index: number;
  /** YYYY-MM-DD, startDate + index. */
  date: string;
  travelMode: TravelMode;
  /** A short name for the day ("Karaköy & Galata"); "" when it has none. */
  title: string;
  places: PlaceView[];
};

/** The longest a day's title can be, in characters (code points). */
export const DAY_TITLE_MAX = 40;

/** A day's title as kept: trimmed, at most DAY_TITLE_MAX characters (never splitting one). */
export function dayTitle(value: string): string {
  return Array.from(value.trim()).slice(0, DAY_TITLE_MAX).join("").trimEnd();
}

export type ChecklistItemView = {
  id: string;
  text: string;
  done: boolean;
  assignee: string | null;
  order: string;
};

export type MemberView = { id: string /* user id */; name: string; colour: string };

export type TripView = {
  name: string;
  startDate: string;
  destination: Destination | null;
  isDemo: boolean;
  locale: Locale;
  days: DayView[];
  ideas: PlaceView[];
  suggestions: PlaceView[];
  dismissed: PlaceView[];
  checklist: ChecklistItemView[];
  members: MemberView[];
  placeCount: number;
};

/** A wall-clock time "HH:MM", 00:00–23:59. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}
export const DEFAULT_TRAVEL_MODE: TravelMode = "walk";

import type { Category } from "./categories";

/**
 * Document layout. Top-level shares are exactly these five (the sync server
 * rejects anything else):
 * - meta: Y.Map { name, startDate, destination, isDemo, locale }
 * - places: Y.Map<placeId, Y.Map { name, lat, lng, osmId, address, category, tags,
 *     stayMinutes, dayId, order, addedBy, createdAt, status, votes: Y.Map<userId, 1 | -1>,
 *     note: Y.XmlFragment, deletedBy (set just before the place is deleted, see deletePlace) }>
 * - days: Y.Map<dayId, Y.Map { index, startTime, travelMode, note: Y.XmlFragment }>
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
  /** HH:MM wall-clock. */
  startTime: string;
  travelMode: TravelMode;
  places: PlaceView[];
};

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

export const DEFAULT_START_TIME = "09:00";
export const DEFAULT_TRAVEL_MODE: TravelMode = "walk";

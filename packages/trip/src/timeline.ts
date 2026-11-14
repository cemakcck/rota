import type { DayView } from "./schema";
import type { Leg } from "./travel";

export type TimelineEntry = {
  placeId: string;
  /** "HH:MM", or null for an untimed stop before any timed one. */
  arrive: string | null;
  leave: string | null;
  /** True when `arrive` is worked out from the stop before (the stop has no set time). */
  estimated: boolean;
  /** Minutes between the set time and the earliest you could get there (previous end + travel), when that is 5 or more later. */
  lateBy: number | null;
  /** Midnights passed by the time the stop ends (0 for a stop without a time). */
  overflowDays: number;
};

const DAY = 24 * 60;
/** Suggestions land on 5-minute marks, rounded up; arriving less than this late is not flagged (ruling F2). */
const STEP = 5;

function clock(totalMinutes: number): string {
  const m = ((Math.round(totalMinutes) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

const travel = (leg: Leg | null | undefined) => (leg?.seconds ?? 0) / 60;

type Span = { arrive: number; leave: number; late: number | null };

/** Per stop: arrive/leave in minutes from the day's midnight, or null when nothing timed comes before it. */
function spans(day: DayView, legs: readonly (Leg | null)[]): (Span | null)[] {
  let end: number | null = null;
  return day.places.map((place, i) => {
    const reachable = end === null ? null : end + travel(legs[i - 1]);
    let arrive: number;
    let late: number | null = null;
    if (place.time !== null) {
      arrive = minutes(place.time);
      // Straight-line and routed travel differ by a few minutes: under STEP is not worth a warning.
      const by = reachable === null ? 0 : reachable - arrive;
      if (by >= STEP) late = Math.round(by);
    } else if (reachable !== null) {
      arrive = reachable;
    } else {
      return null;
    }
    end = arrive + place.stayMinutes;
    return { arrive, leave: end, late };
  });
}

/**
 * Wall-clock arrive/leave per stop. A stop with a set time arrives then; an untimed stop after a
 * timed one is estimated from the stop before (its arrival + stay + travel); untimed stops before
 * any timed stop have no time. `legs[i]` is the travel between stop i and i + 1 (null = unknown,
 * counted as zero).
 */
export function dayTimeline(day: DayView, legs: readonly (Leg | null)[]): TimelineEntry[] {
  return spans(day, legs).map((span, i) => {
    const placeId = day.places[i].id;
    if (!span) return { placeId, arrive: null, leave: null, estimated: false, lateBy: null, overflowDays: 0 };
    return {
      placeId,
      arrive: clock(span.arrive),
      leave: clock(span.leave),
      estimated: day.places[i].time === null,
      lateBy: span.late,
      // Midnights passed by the time the stop ends (so a stop that ends at 00:00 already reports 1).
      overflowDays: Math.floor(span.leave / DAY),
    };
  });
}

/**
 * The suggested time for a stop at position `index` of `day`: the previous stop's arrival + stay +
 * travel to the slot (`legs[index - 1]`, unknown = zero), rounded up to the next 5 minutes. Null when no timed stop comes before, or
 * when that would reach midnight (a suggestion never wraps to the next day).
 * `day` and `legs` describe the day as it is (or will be) around that slot.
 */
export function suggestTime(day: DayView, legs: readonly (Leg | null)[], index: number): string | null {
  if (index <= 0) return null;
  const previous = spans({ ...day, places: day.places.slice(0, index) }, legs)[index - 1];
  if (!previous) return null;
  // Rounded up (never earlier than reachable); the epsilon keeps float noise on a whole mark from adding 5.
  const at = Math.ceil((previous.leave + travel(legs[index - 1])) / STEP - 1e-9) * STEP;
  return at < DAY ? clock(at) : null;
}

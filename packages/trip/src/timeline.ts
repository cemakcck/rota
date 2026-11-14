import type { DayView } from "./schema";
import type { Leg } from "./travel";

export type TimelineEntry = { placeId: string; arrive: string; leave: string; overflowDays: number };

const DAY = 24 * 60;

function clock(totalMinutes: number): string {
  const m = ((Math.round(totalMinutes) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Wall-clock arrive/leave per stop. `legs[i]` is the travel between stop i and
 * i + 1 (null = unknown, counted as zero). `overflowDays` is how many midnights
 * have passed when the stop ends.
 */
export function dayTimeline(day: DayView, legs: (Leg | null)[]): TimelineEntry[] {
  const [h, m] = day.startTime.split(":").map(Number);
  let now = h * 60 + m;
  return day.places.map((place, i) => {
    if (i > 0) now += (legs[i - 1]?.seconds ?? 0) / 60;
    const arrive = now;
    now += place.stayMinutes;
    return {
      placeId: place.id,
      arrive: clock(arrive),
      leave: clock(now),
      // Midnights passed by the time the stop ends (so a stop that ends at
      // 00:00 already reports 1).
      overflowDays: Math.floor(now / DAY),
    };
  });
}

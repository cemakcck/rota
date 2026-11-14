import { useMemo } from "react";
import { closedAllDay, dayTimeline, hoursWarning, type HoursWarning, type Leg, type Locale, type TripView } from "@rota/trip";
import { apiFetch } from "./authClient";
import { createRemote, getJson, useRemote } from "./remote";

/** A warning for a stop, with what its text needs: the day's date and the set or estimated arrival (null for an untimed stop). */
export type StopWarning = { warning: HoursWarning; date: string; arrive: string | null };

// One request per batch of up to 25 OSM ids; each id's hours are kept on their own.
const hours = createRemote<string | null>(async (ids, signal) => {
  const body = await getJson<{ hours: Record<string, string | null> }>(`/api/hours?ids=${ids.join(",")}`, apiFetch, signal);
  return new Map(ids.map((id) => [id, body.hours[id] ?? null]));
}, 25);

/**
 * Opening-hours warnings for the trip's planned stops, by place id (spec §8.2): OpenStreetMap's hours
 * at the stop's set or estimated arrival and stay. A stop with no time can only be warned that the
 * place is closed all day. No hours known, no warning.
 */
export function useHours(view: TripView, legsFor: (dayId: string) => (Leg | null)[], locale: Locale): Map<string, StopWarning> {
  const ids = useMemo(() => [...new Set(view.days.flatMap((d) => d.places.flatMap((p) => (p.osmId ? [p.osmId] : []))))], [view.days]);
  // Re-renders as hours arrive.
  const { get } = useRemote(hours, ids);
  const warnings = new Map<string, StopWarning>();
  for (const day of view.days) {
    const timeline = dayTimeline(day, legsFor(day.id));
    day.places.forEach((place, i) => {
      const tag = place.osmId ? get(place.osmId) : null;
      if (!tag || !day.date) return;
      const { arrive, leave } = timeline[i];
      if (arrive === null || leave === null) {
        if (closedAllDay(tag, day.date)) warnings.set(place.id, { warning: { kind: "closed-day" }, date: day.date, arrive: null });
        return;
      }
      const warning = hoursWarning(tag, day.date, arrive, leave, locale);
      if (warning) warnings.set(place.id, { warning, date: day.date, arrive });
    });
  }
  return warnings;
}

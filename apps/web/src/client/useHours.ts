import { useMemo } from "react";
import { closedAllDay, dayTimeline, hoursWarning, openingTimes, type HoursWarning, type Leg, type Locale, type TripView } from "@rota/trip";
import { apiFetch } from "./authClient";
import { createRemote, getJson, useRemote } from "./remote";

/** A warning for a stop, with what its text needs: the day's date and the set or estimated arrival (null for an untimed stop). */
export type StopWarning = { warning: HoursWarning; date: string; arrive: string | null };

// One request per batch of up to 25 OSM ids; each id's hours are kept on their own.
const hours = createRemote<string | null>(async (ids, signal) => {
  const body = await getJson<{ hours: Record<string, string | null> }>(`/api/hours?ids=${ids.join(",")}`, apiFetch, signal);
  return new Map(ids.map((id) => [id, body.hours[id] ?? null]));
}, 25);

/** What a stop's details show: when it is open that day ("09:00–20:30" spans; empty when closed). */
export type StopHours = string[];

/**
 * Opening-hours warnings for the trip's planned stops, by place id (spec §8.2): OpenStreetMap's hours
 * at the stop's set or estimated arrival and stay. A stop with no time can only be warned that the
 * place is closed all day. No hours known, no warning. Also when each stop is open on its day, for its
 * details (none when unknown).
 */
export function useHours(
  view: TripView,
  legsFor: (dayId: string) => (Leg | null)[],
  locale: Locale,
): { warnings: Map<string, StopWarning>; open: Map<string, StopHours> } {
  const ids = useMemo(() => [...new Set(view.days.flatMap((d) => d.places.flatMap((p) => (p.osmId ? [p.osmId] : []))))], [view.days]);
  // Re-renders as hours arrive; `version` changes with each answer.
  const { get, version } = useRemote(hours, ids);
  // Parsing opening_hours is not cheap: only again when the days, their legs or the fetched hours change.
  return useMemo(() => {
    const warnings = new Map<string, StopWarning>();
    const open = new Map<string, StopHours>();
    for (const day of view.days) {
      const timeline = dayTimeline(day, legsFor(day.id));
      day.places.forEach((place, i) => {
        const tag = place.osmId ? get(place.osmId) : null;
        if (!tag || !day.date) return;
        const times = openingTimes(tag, day.date);
        if (times) open.set(place.id, times);
        const { arrive, leave } = timeline[i];
        if (arrive === null || leave === null) {
          if (closedAllDay(tag, day.date)) warnings.set(place.id, { warning: { kind: "closed-day" }, date: day.date, arrive: null });
          return;
        }
        const warning = hoursWarning(tag, day.date, arrive, leave, locale);
        if (warning) warnings.set(place.id, { warning, date: day.date, arrive });
      });
    }
    return { warnings, open };
    // `get` is the shared cache's (stable) reader; `version` stands for its answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is what changes when `get` has new answers
  }, [view.days, legsFor, locale, get, version]);
}

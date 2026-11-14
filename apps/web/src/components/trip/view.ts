"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { TripView } from "@rota/trip";

/** What the list column and the map show: one day, Ideas & votes, the checklist, or the whole trip. */
export type TripViewState = { kind: "day"; dayId: string } | { kind: "ideas" } | { kind: "checklist" } | { kind: "all" };

/** The address's `?view=&day=` for a view, other parameters (such as `friend`) kept. */
export function viewHref(href: string, v: TripViewState): string {
  const url = new URL(href);
  url.searchParams.set("view", v.kind);
  if (v.kind === "day") url.searchParams.set("day", v.dayId);
  else url.searchParams.delete("day");
  return url.href;
}

/** The view an address asks for, or null when it asks for none (or for nothing this screen knows). */
export function parseView(search: string): TripViewState | null {
  const params = new URLSearchParams(search);
  const kind = params.get("view");
  if (kind === "ideas" || kind === "checklist" || kind === "all") return { kind };
  const day = params.get("day");
  if (kind === "day" && day) return { kind: "day", dayId: day };
  return null;
}

export const sameView = (a: TripViewState, b: TripViewState) => a.kind === b.kind && (a.kind !== "day" || a.dayId === (b as { dayId: string }).dayId);

/** Today's date on this device, YYYY-MM-DD. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The first day, or today's day while the trip is on; Ideas when the trip has no days. */
export function defaultView(trip: TripView, date = today()): TripViewState {
  const day = trip.days.find((d) => d.date === date) ?? trip.days[0];
  return day ? { kind: "day", dayId: day.id } : { kind: "ideas" };
}

// The address, as an external store: replaced by this hook, or changed by back/forward.
const CHANGED = "rota:view";
function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/**
 * Writes the view into the address without a new history entry and without a navigation (no server
 * round trip, so it works offline). Next.js keeps its router state through `history.replaceState`.
 */
function writeView(v: TripViewState) {
  const href = viewHref(window.location.href, v);
  if (href === window.location.href) return;
  window.history.replaceState(window.history.state, "", href);
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * The selected view, mirrored in the address (`?view=day&day=<id>`, `?view=ideas|checklist|all`) so
 * reloads and shared links land in the same place. Without one: the first day (today's while the trip
 * is on). When the selected day disappears (removed elsewhere), the nearest remaining day takes over
 * (the one now at its position, else the last), or Ideas when no day is left; the address follows.
 * Nothing is resolved before `ready` (the trip read from this device), so deep links survive loading.
 */
export function useTripView(trip: TripView, ready = true): [TripViewState, (v: TripViewState) => void] {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  // The day last shown and its position, to find its nearest neighbour if it goes.
  const [shown, setShown] = useState<{ dayId: string; index: number } | null>(null);

  const asked = parseView(search);
  let state: TripViewState;
  // Until the trip is read (its first view has no days), the address is taken as it is: nothing is
  // resolved against the empty trip, and nothing is written back.
  if (!ready) state = asked ?? defaultView(trip);
  else if (!asked) state = defaultView(trip);
  else if (asked.kind !== "day" || trip.days.some((d) => d.id === asked.dayId)) state = asked;
  else if (shown?.dayId === asked.dayId) {
    const day = trip.days[Math.min(shown.index, trip.days.length - 1)];
    state = day ? { kind: "day", dayId: day.id } : { kind: "ideas" };
  } else state = defaultView(trip);

  // The address asked for something that is gone: it now names what is shown. Until it does, the
  // day last shown stays remembered, so the fallback holds steady.
  const stale = ready && asked !== null && !sameView(asked, state);
  if (ready && state.kind === "day" && !stale) {
    const index = trip.days.findIndex((d) => d.id === (state as { dayId: string }).dayId);
    if (shown?.dayId !== state.dayId || shown.index !== index) setShown({ dayId: state.dayId, index });
  }
  const kind = state.kind;
  const dayId = state.kind === "day" ? state.dayId : null;
  useEffect(() => {
    if (stale) writeView(dayId ? { kind: "day", dayId } : ({ kind } as TripViewState));
  }, [stale, kind, dayId]);

  const set = useCallback((v: TripViewState) => writeView(v), []);
  return [state, set];
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type * as Y from "yjs";
import { readTrip, type PlaceView, type TripView } from "@rota/trip";
import type { PlanActions } from "./DayPlan";
import { placeFocusId, type StopActions } from "./StopRow";
import { plannedLists, type ListId } from "./plan";

/**
 * What a stop's row and its details panel can do, wired to the plan: Move up/down and Alt+↑/↓ swap
 * with a neighbour, and this person's own reorders and time changes are said politely (`status`;
 * others' changes come from the Announcer); Move to… opens the Move dialog (`moving`), which closes
 * by itself when the place goes (deleted or un-planned elsewhere).
 */
export function usePlaceControls(
  doc: Y.Doc,
  view: TripView,
  actions: PlanActions | null,
): { stopActions: StopActions | null; status: string; moving: { list: ListId; place: PlaceView } | null; closeMove(): void } {
  const t = useTranslations("trip");
  const [moving, setMoving] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const lists = plannedLists(view);
  const find = (id: string | null) => {
    for (const list of lists) {
      const place = list.places.find((p) => p.id === id);
      if (place) return { list: list.id, place };
    }
    return null;
  };
  const movingPlace = find(moving);
  if (moving !== null && !movingPlace) setMoving(null);

  // After this person's own reorder or time change: where the stop is now, and its time if it has one.
  const sayWhere = (id: string) => {
    const list = plannedLists(readTrip(doc)).find((l) => l.places.some((p) => p.id === id));
    if (!list) return;
    const position = list.places.findIndex((p) => p.id === id) + 1;
    const place = list.places[position - 1];
    const name = place.name || t("unnamed");
    const total = list.places.length;
    setStatus(place.time === null || list.id === null ? t("reorderedTo", { name, position, total }) : t("reorderedToAt", { name, time: place.time, position, total }));
  };

  const stopActions: StopActions | null = actions && {
    save: actions.save,
    remove: actions.remove,
    openMove: setMoving,
    setTime(id, time) {
      actions.setTime(id, time);
      if (time !== null) return sayWhere(id);
      const place = find(id)?.place;
      if (place) setStatus(t("timeCleared", { name: place.name || t("unnamed") }));
    },
    nudge(id, by) {
      const list = find(id);
      const places = lists.find((l) => l.id === list?.list)?.places ?? [];
      const at = places.findIndex((p) => p.id === id);
      const neighbour = places[at + by];
      if (!list || !neighbour) return;
      if (!actions.move(id, by < 0 ? { dayId: list.list, beforeId: neighbour.id } : { dayId: list.list, afterId: neighbour.id })) return;
      sayWhere(id);
      // Focus stays on what was used (the name with Alt+arrows, or the Move up/down button).
      const was = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      requestAnimationFrame(() => (was?.isConnected ? was : document.getElementById(placeFocusId(id)))?.focus());
    },
  };

  return { stopActions, status, moving: movingPlace, closeMove: () => setMoving(null) };
}

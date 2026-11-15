"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type * as Y from "yjs";
import { readTrip, type PlaceView, type TripView } from "@rota/trip";
import type { PlanActions } from "./DayPlan";
import type { Schedule } from "./IdeasView";
import { placeFocusId, type StopActions } from "./StopRow";
import { plannedLists, type ListId } from "./plan";

/** Shows an Undo toast for this person's last action (its own undo step): what happened, and Undo's accessible name. */
export type UndoToast = (message: string, undoLabel: string) => void;

/**
 * What a stop's row and its details panel can do, wired to the plan (and an idea's Add to day…): Move up/down and Alt+↑/↓ swap
 * with a neighbour, and this person's own reorders and time changes are said politely (`status`;
 * others' changes come from the Announcer); Move to… opens the Move dialog (`moving`), which closes
 * by itself when the place goes (deleted or un-planned elsewhere). A move to another list (Move to…,
 * a drop on another day or Ideas, an idea's Add to day…) and a cleared time are said by an Undo toast
 * (`undoToast`) instead.
 */
export function usePlaceControls(
  doc: Y.Doc,
  view: TripView,
  actions: PlanActions | null,
  undoToast: UndoToast,
): {
  stopActions: StopActions | null;
  schedule: Schedule | null;
  status: string;
  moving: { list: ListId; place: PlaceView } | null;
  closeMove(): void;
  /** Move to…: to another list, keeping a set time; said politely. */
  moveTo(id: string, to: ListId): void;
  /** After this person's own drop: where the stop is now (and its time), said politely. */
  sayMoved(id: string, from: ListId): void;
} {
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

  // After this person's own reorder, move or time change: where the stop is now (naming the list when
  // it changed from `from`), and its time if it has one.
  const sayWhere = (id: string, from?: ListId) => {
    const now = readTrip(doc);
    const list = plannedLists(now).find((l) => l.places.some((p) => p.id === id));
    if (!list) return;
    const position = list.places.findIndex((p) => p.id === id) + 1;
    const place = list.places[position - 1];
    const name = place.name || t("unnamed");
    const total = list.places.length;
    const time = list.id === null ? null : place.time;
    if (from !== undefined && from !== list.id) {
      const index = now.days.findIndex((d) => d.id === list.id);
      const label = index < 0 ? t("ideas") : t("day", { n: index + 1 });
      const message = time === null ? t("movedTo", { name, list: label, position, total }) : t("movedToAt", { name, list: label, time, position, total });
      return undoToast(message, t("undoMoveFor", { name }));
    }
    setStatus(time === null ? t("reorderedTo", { name, position, total }) : t("reorderedToAt", { name, time, position, total }));
  };

  const stopActions: StopActions | null = actions && {
    save: actions.save,
    remove: actions.remove,
    openMove: setMoving,
    setTime(id, time) {
      const place = find(id)?.place;
      actions.setTime(id, time);
      if (time !== null) return sayWhere(id);
      if (!place) return;
      const name = place.name || t("unnamed");
      if (place.time === null) return setStatus(t("timeCleared", { name }));
      undoToast(t("timeCleared", { name }), t("undoClearTimeFor", { name }));
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

  // An idea put into a day: said by an Undo toast (the view stays on Ideas, so it would otherwise go
  // unseen), whose Undo puts it back in Ideas.
  const schedule: Schedule | null =
    actions &&
    ((id, dayId, time, stayMinutes) => {
      const place = find(id)?.place;
      if (!actions.schedule(id, dayId, time, stayMinutes)) return;
      const index = view.days.findIndex((d) => d.id === dayId);
      if (!place || index < 0) return;
      const name = place.name || t("unnamed");
      const list = t("day", { n: index + 1 });
      undoToast(time === null ? t("addedTo", { list }) : t("addedToAt", { list, time }), t("undoAddFor", { name }));
    });

  const moveTo = (id: string, to: ListId) => {
    const from = find(id)?.list;
    if (actions && from !== undefined && actions.moveTo(id, to)) sayWhere(id, from);
  };

  return { stopActions, schedule, status, moving: movingPlace, closeMove: () => setMoving(null), moveTo, sayMoved: sayWhere };
}

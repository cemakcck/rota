"use client";

import { useState } from "react";
import type { Announcements } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { dayTimeline, type DayPatch, type PlaceView, type Slot, type TripView } from "@rota/trip";
import type { StopWarning } from "@/client/useHours";
import type { Travel } from "@/client/useTravel";
import type { DayWeather } from "@/client/useWeather";
import { MoveDialog } from "./MoveDialog";
import { placeMoveId, type PlaceActions } from "./PlaceRow";
import { DaySection } from "./DaySection";
import { Suggestions, type SuggestionActions } from "./Suggestions";
import { plannedLists, type ListId } from "./plan";

/**
 * dnd-kit's own screen reader output (an assertive live region with English "Picked up draggable item
 * <id>" messages, and keyboard instructions for a keyboard sensor this screen does not use) is silenced
 * and rendered into a detached element. Dragging is pointer-only; keyboard and screen reader users move
 * places with the row buttons and the Move to… dialog, and others' moves come from the Announcer.
 * The checklist does the same.
 */
export const SILENT: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

export type ItineraryActions = PlaceActions & {
  move(id: string, to: { dayId: ListId } & Slot): boolean;
  setDay(dayId: string, patch: DayPatch): void;
} & SuggestionActions;

/** What the itinerary shows: one day, Ideas with the suggestions, or every day then Ideas. */
export type ItineraryScope = { dayId: string } | "ideas" | "all";

/**
 * The days in scope, then (for Ideas or the whole trip) Ideas and the suggestions. Places move by
 * dragging (pointer; the drag context is the trip screen's, so rows also drop on the rail), or with the
 * row's up/down buttons and the Move to… dialog (keyboard and screen readers).
 */
export function Itinerary({
  view,
  scope,
  visible,
  travel,
  warnings,
  weather,
  listLabel,
  dayDate,
  selectedId,
  onSelect,
  actions,
  userId,
}: {
  view: TripView;
  /** What to show: one day, Ideas with the suggestions, or everything. */
  scope: ItineraryScope;
  visible: (p: PlaceView) => boolean;
  /** Each day's travel, by day id. */
  travel: Record<string, Travel>;
  /** Opening-hours warnings by place id. */
  warnings: Map<string, StopWarning>;
  /** Weather by date. */
  weather: Record<string, DayWeather>;
  listLabel: (list: ListId) => string;
  dayDate: (date: string) => string;
  /** The place selected in the list or on the map. */
  selectedId: string | null;
  onSelect(id: string): void;
  actions: ItineraryActions | null;
  userId: string | null;
}) {
  const t = useTranslations("trip");
  const [moving, setMoving] = useState<string | null>(null);

  const lists = plannedLists(view);
  const find = (id: string | null) => {
    for (const list of lists) {
      const place = list.places.find((p) => p.id === id);
      if (place) return { list: list.id, place };
    }
    return null;
  };
  const listChoiceLabel = (id: ListId) => (id === null ? t("ideas") : `${listLabel(id)} · ${dayDate(view.days.find((d) => d.id === id)!.date)}`);
  const movingPlace = find(moving);

  // Someone else deleted (or un-planned) the place while its Move dialog was open: the dialog closes
  // (and puts focus somewhere that still exists, see MoveDialog).
  if (moving !== null && !movingPlace) setMoving(null);

  const rowActions: ItineraryActions | null = actions && { ...actions, openMove: setMoving };
  const days = scope === "all" ? view.days : scope === "ideas" ? [] : view.days.filter((d) => d.id === scope.dayId);
  const ideas = scope === "all" || scope === "ideas";

  return (
    <>
      {days.map((day) => (
        <DaySection
          key={day.id}
          day={day}
          title={listLabel(day.id)}
          subtitle={dayDate(day.date)}
          places={day.places}
          timeline={dayTimeline(day, travel[day.id]?.legs ?? [])}
          travel={travel[day.id]}
          warnings={warnings}
          weather={weather[day.date]}
          visible={visible}
          selectedId={selectedId}
          onSelect={onSelect}
          members={view.members}
          actions={rowActions}
          onDay={actions && ((patch) => actions.setDay(day.id, patch))}
        />
      ))}
      {ideas && (
        <>
          <DaySection
            title={t("ideas")}
            places={view.ideas}
            visible={visible}
            selectedId={selectedId}
            onSelect={onSelect}
            members={view.members}
            actions={rowActions}
            onDay={null}
          />
          <Suggestions
            suggestions={view.suggestions}
            dismissed={view.dismissed}
            members={view.members}
            userId={userId}
            lists={lists.map((l) => ({ id: l.id, label: listChoiceLabel(l.id) }))}
            actions={actions}
          />
        </>
      )}

      {movingPlace && actions && (
        <MoveDialog
          place={movingPlace.place}
          current={movingPlace.list}
          lists={lists.map((l) => ({ id: l.id, label: listChoiceLabel(l.id) }))}
          onClose={() => {
            const id = movingPlace.place.id;
            setMoving(null);
            requestAnimationFrame(() => document.getElementById(placeMoveId(id))?.focus());
          }}
          onMove={(to) => {
            const id = movingPlace.place.id;
            actions.move(id, { dayId: to });
            setMoving(null);
            requestAnimationFrame(() => document.getElementById(placeMoveId(id))?.focus());
          }}
        />
      )}
    </>
  );
}

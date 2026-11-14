"use client";

import { useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { dayTimeline, type DayPatch, type Leg, type PlaceView, type Slot, type TripView } from "@rota/trip";
import { MoveDialog } from "./MoveDialog";
import { placeMoveId, type PlaceActions } from "./PlaceRow";
import { DaySection } from "./DaySection";
import { dropTarget, plannedLists, type ListId } from "./plan";

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
};

/**
 * The days in order, then Ideas. Places move by dragging (pointer), or with the row's up/down buttons
 * and the Move to… dialog (keyboard and screen readers).
 */
export function Itinerary({
  view,
  visible,
  legsFor,
  listLabel,
  dayDate,
  actions,
}: {
  view: TripView;
  visible: (p: PlaceView) => boolean;
  legsFor: (dayId: string) => (Leg | null)[];
  listLabel: (list: ListId) => string;
  dayDate: (date: string) => string;
  actions: ItineraryActions | null;
}) {
  const t = useTranslations("trip");
  const [moving, setMoving] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [offscreen] = useState(() => (typeof document === "undefined" ? undefined : document.createElement("div")));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const lists = plannedLists(view);
  const find = (id: string | null) => {
    for (const list of lists) {
      const place = list.places.find((p) => p.id === id);
      if (place) return { list: list.id, place };
    }
    return null;
  };
  const movingPlace = find(moving);

  // Someone else deleted (or un-planned) the place while its Move dialog was open: the dialog closes
  // (and puts focus somewhere that still exists, see MoveDialog).
  if (moving !== null && !movingPlace) setMoving(null);

  const rowActions: ItineraryActions | null = actions && { ...actions, openMove: setMoving };

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    if (!actions || !over) return;
    const to = dropTarget(view, String(active.id), String(over.id));
    if (to) actions.move(String(active.id), to);
  }

  const dragged = find(dragging)?.place;
  return (
    <DndContext
      accessibility={{ announcements: SILENT, screenReaderInstructions: { draggable: "" }, container: offscreen }}
      sensors={sensors}
      onDragStart={({ active }) => setDragging(String(active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      {view.days.map((day) => (
        <DaySection
          key={day.id}
          day={day}
          title={listLabel(day.id)}
          subtitle={dayDate(day.date)}
          places={day.places}
          timeline={dayTimeline(day, legsFor(day.id))}
          visible={visible}
          members={view.members}
          actions={rowActions}
          onDay={actions && ((patch) => actions.setDay(day.id, patch))}
        />
      ))}
      <DaySection title={t("ideas")} places={view.ideas} visible={visible} members={view.members} actions={rowActions} onDay={null} />

      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div className="rounded-xl border border-ink bg-surface px-3 py-2 text-[14px] font-semibold shadow-2 [overflow-wrap:anywhere]">{dragged.name || t("unnamed")}</div>
        )}
      </DragOverlay>

      {movingPlace && actions && (
        <MoveDialog
          place={movingPlace.place}
          current={movingPlace.list}
          lists={lists.map((l) => ({ id: l.id, label: l.id === null ? t("ideas") : `${listLabel(l.id)} · ${dayDate(view.days.find((d) => d.id === l.id)!.date)}` }))}
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
    </DndContext>
  );
}

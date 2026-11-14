"use client";

import { Fragment, useId, useRef, useState, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import type { PlaceView, TripView } from "@rota/trip";
import type { StopWarning } from "@/client/useHours";
import type { Travel } from "@/client/useTravel";
import { btn, btnPrimary, btnSm } from "../ui";
import type { ListChoice } from "./MoveDialog";
import { listDropId } from "./plan";
import { suggestedFor } from "./SearchBar";
import { stayFrom, timeFrom, TimeStayFields } from "./TimeStayFields";
import { StopRow, type StopActions } from "./StopRow";
import { Suggestions, type SuggestionActions } from "./Suggestions";
import { useStay } from "./TravelLeg";

/** What the rows of a list share (see DayPlan). */
export type RowProps = {
  visible: (p: PlaceView) => boolean;
  warnings: Map<string, StopWarning>;
  selectedId: string | null;
  openId: string | null;
  /** A place just added: its row is highlighted for a moment. */
  highlightId?: string | null;
  /** The place hovered here or on the map, and who to tell when the pointer goes onto a row or off it. */
  hoveredId?: string | null;
  onHover?(id: string | null): void;
  onOpen(id: string, open: boolean): void;
  actions: StopActions | null;
};

/** A day an idea can go to: "Day N · date" for the choice, "Day N" for the button. */
export type DayChoice = { id: string; label: string; name: string };

/** Puts an idea into a day, at a time (null: untimed) and with a stay, as one step. */
export type Schedule = (id: string, dayId: string, time: string | null, stayMinutes: number) => void;

const addButtonId = (id: string) => `idea-add-${id}`;

/**
 * An idea's "Add to day…" step (spec §2b, as when adding from the search): which day (the first by
 * default), when (prefilled with the time suggested after that day's last stop, editable, may be left
 * empty) and for how long. Changing the day changes the suggestion until the time is typed in.
 */
function ScheduleStep({
  place,
  view,
  travel,
  days,
  onSchedule,
  onCancel,
}: {
  place: PlaceView;
  view: TripView;
  travel: Record<string, Travel>;
  days: DayChoice[];
  onSchedule: Schedule;
  onCancel(): void;
}) {
  const t = useTranslations("trip");
  const tc = useTranslations("common");
  const id = useId();
  const timeRef = useRef<HTMLInputElement>(null);
  const at = { lat: place.lat ?? undefined, lng: place.lng ?? undefined };
  const suggestion = (dayId: string) => {
    const day = view.days.find((d) => d.id === dayId);
    return suggestedFor(day, day ? (travel[day.id]?.legs ?? []) : [], at);
  };
  const [dayId, setDayId] = useState(days[0].id);
  const [time, setTime] = useState(() => suggestion(days[0].id));
  const [typed, setTyped] = useState(false);
  const [stay, setStay] = useState(String(place.stayMinutes));
  const [invalid, setInvalid] = useState(false);
  const name = place.name || t("unnamed");
  const dayName = days.find((d) => d.id === dayId)?.name ?? "";

  function submit() {
    const parsed = timeFrom(time, timeRef.current);
    if (parsed === null) {
      setInvalid(true);
      return timeRef.current?.focus();
    }
    onSchedule(place.id, dayId, parsed || null, stayFrom(stay, place.stayMinutes));
  }

  return (
    <form
      aria-label={t("addToDayFor", { name })}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      className="mx-3 mb-3 grid gap-3 rounded-xl border border-line bg-paper p-3"
    >
      <TimeStayFields
        id={id}
        timeRef={timeRef}
        withTime
        time={time}
        suggested={suggestion(dayId)}
        onTime={(v) => {
          setTime(v);
          setTyped(true);
          setInvalid(false);
        }}
        invalid={invalid}
        stay={stay}
        onStay={setStay}
        before={
          <div>
            <label htmlFor={`${id}-day`} className="mb-1 block text-[13px] font-medium">
              {t("scheduleDay")}
            </label>
            <select
              id={`${id}-day`}
              autoFocus
              className="h-9 max-w-[180px] rounded-lg border border-ink-2 bg-surface px-2 text-[14px]"
              value={dayId}
              onChange={(e) => {
                setDayId(e.target.value);
                if (!typed) setTime(suggestion(e.target.value));
              }}
            >
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${btnPrimary} ${btnSm}`}>
          {t("addToList", { list: dayName })}
        </button>
        <button type="button" className={`${btn} ${btnSm} ml-auto`} onClick={onCancel}>
          {tc("cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * Ideas & votes (spec §2), in the list column: the search bar (adding to Ideas or as a suggestion),
 * the ideas as rows, each with "Add to day…" (the add step's day, time and stay), then the suggestions
 * with their votes, Accept and Dismiss, and the dismissed ones behind a disclosure. Adding an idea to
 * a day keeps this view (nothing else switches); it is said politely by the screen.
 * Without `search` (the whole trip, under its days) it is the same lists without the bar.
 */
export function IdeasView({
  view,
  travel,
  rows,
  search,
  suggestionActions,
  onSchedule,
  userId,
  lists,
  dayChoices,
}: {
  view: TripView;
  travel: Record<string, Travel>;
  rows: RowProps;
  search?: ReactNode;
  suggestionActions: SuggestionActions | null;
  /** Null while the user cannot edit. */
  onSchedule: Schedule | null;
  userId: string | null;
  /** Where an accepted suggestion can go: the days, then Ideas. */
  lists: ListChoice[];
  /** The days an idea can be added to. */
  dayChoices: DayChoice[];
}) {
  const t = useTranslations("trip");
  const stay = useStay();
  const headingId = useId();
  const [scheduling, setScheduling] = useState<string | null>(null);
  const { setNodeRef, isOver } = useDroppable({ id: listDropId(null), disabled: !rows.actions });
  const canSchedule = onSchedule !== null && dayChoices.length > 0;

  // The idea went (moved, deleted, accepted elsewhere) while its step was open: the step goes with it.
  if (scheduling !== null && !view.ideas.some((p) => p.id === scheduling)) setScheduling(null);

  const cancel = (id: string) => {
    setScheduling(null);
    requestAnimationFrame(() => document.getElementById(addButtonId(id))?.focus());
  };

  return (
    <>
      {search && <div className="pt-3">{search}</div>}
      <section aria-labelledby={headingId} className="min-w-0 pb-3">
        <h2 id={headingId} tabIndex={-1} className="px-5 pb-2.5 pt-4 font-serif text-[22px] font-semibold leading-tight outline-none">
          {t("ideas")}
        </h2>
        <div ref={setNodeRef} className={`mx-5 min-w-0 rounded-xl ${isOver ? "bg-hover outline-2 outline-dashed outline-ink-2" : ""}`}>
          {view.ideas.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-[13px] text-ink-2">{t("ideasEmpty")}</p>
          ) : (
            <ol className="grid min-w-0">
              {view.ideas.map((place, i) => {
                const name = place.name || t("unnamed");
                const open = scheduling === place.id;
                return (
                  <Fragment key={place.id}>
                    {i > 0 && <li aria-hidden="true" className="h-2 min-w-0" />}
                    <StopRow
                      place={place}
                      colour="#78716c"
                      dimmed={!rows.visible(place)}
                      warning={rows.warnings.get(place.id)}
                      selected={place.id === rows.selectedId}
                      open={place.id === rows.openId}
                      highlighted={place.id === rows.highlightId}
                      hovered={place.id === rows.hoveredId}
                      onHover={rows.onHover}
                      onOpen={rows.onOpen}
                      actions={rows.actions}
                      trailing={
                        // Its stay, as on a day's rows; and the way into a day.
                        <div className="grid justify-items-end gap-1 text-right">
                          {canSchedule && (
                            <button
                              type="button"
                              id={addButtonId(place.id)}
                              aria-label={t("addToDayFor", { name })}
                              aria-expanded={open}
                              onClick={() => (open ? cancel(place.id) : setScheduling(place.id))}
                              className="whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1 text-[12.5px] font-medium text-ink hover:bg-hover"
                            >
                              {t("addToDay")}
                            </button>
                          )}
                          <span className="whitespace-nowrap px-1 text-[12px] text-ink-2">{stay(place.stayMinutes)}</span>
                        </div>
                      }
                      below={
                        open &&
                        onSchedule && (
                          <ScheduleStep
                            place={place}
                            view={view}
                            travel={travel}
                            days={dayChoices}
                            onCancel={() => cancel(place.id)}
                            onSchedule={(...args) => {
                              setScheduling(null);
                              onSchedule(...args);
                              // The row is gone: focus to the list's heading, so it is not lost.
                              requestAnimationFrame(() => document.getElementById(headingId)?.focus());
                            }}
                          />
                        )
                      }
                    />
                  </Fragment>
                );
              })}
            </ol>
          )}
        </div>
      </section>
      <Suggestions
        suggestions={view.suggestions}
        dismissed={view.dismissed}
        members={view.members}
        userId={userId}
        lists={lists}
        suggest={(dayId, place) => {
          const day = view.days.find((d) => d.id === dayId);
          return suggestedFor(day, day ? (travel[day.id]?.legs ?? []) : [], { lat: place.lat ?? undefined, lng: place.lng ?? undefined });
        }}
        actions={suggestionActions}
      />
    </>
  );
}

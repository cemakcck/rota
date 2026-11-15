"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { placeNote, type PlacePatch, type PlaceView, type TimelineEntry } from "@rota/trip";
import type { StopWarning } from "@/client/useHours";
import { HoursWarning } from "./HoursWarning";
import { CategoryGlyph, Icon } from "./icons";
import { noteFirstLine, noteOrNull } from "./NoteEditor";
import { EditingTag, editingOutline, useCollab, useEditingPeer, usePublishEditing } from "./Presence";
import { parseTime, placeDropId } from "./plan";
import { Approximate, useStay } from "./TravelLeg";

/** What a member can do to a stop; absent while the user is unknown (read-only). */
export type StopActions = {
  /** Saves a change to the place's name, category, tags or stay. */
  save(id: string, patch: PlacePatch): void;
  /** Sets the stop's own time ("HH:MM"), or clears it with null. */
  setTime(id: string, time: string | null): void;
  /** Swaps with the neighbour above (-1) or below (1) in the same list. */
  nudge(id: string, by: -1 | 1): void;
  openMove(id: string): void;
  remove(place: PlaceView): void;
};

/** The id of a stop's own button (its name), where focus goes back to after editing, moving or undoing. */
export const placeFocusId = (id: string) => `place-open-${id}`;
/** The id of a place's Move to… button (in its details), where focus goes back to when the Move dialog closes. */
export const placeMoveId = (id: string) => `place-move-${id}`;
/** The id of a place's row, scrolled into view when its pin is tapped. */
export const placeRowId = (id: string) => `place-row-${id}`;
const placeTimeId = (id: string) => `place-time-${id}`;

/** Clicks on the row's own controls (buttons, links, fields, the note) are theirs, not the row's. */
const CONTROLS = "button, a, input, select, textarea, label, form, [contenteditable], [data-note-editor]";

const focusLater = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

/**
 * The stop's time, edited in place: Enter or leaving the field saves, Escape cancels, empty clears. An
 * invalid time left by blur keeps the field open, saying why; `onAway` tells whether focus is out of it.
 */
function TimeInput({
  place,
  name,
  initial,
  onDone,
  onAway,
}: {
  place: PlaceView;
  name: string;
  initial: string;
  onDone: (time?: string | null) => void;
  onAway: (away: boolean) => void;
}) {
  const t = useTranslations("trip");
  const errorId = `${placeTimeId(place.id)}-error`;
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);
  const finish = (time?: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(time);
  };
  // Something that is not a time is never dropped silently: the field stays, saying why.
  const commit = () => {
    const time = parseTime(draft);
    if (time === null) return setInvalid(true);
    finish(time === "" ? null : time);
  };
  return (
    <>
    <input
      autoFocus
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      maxLength={5}
      aria-label={t("timeFor", { name })}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
      className="h-7 max-lg:-my-2 max-lg:h-11 w-[68px] rounded-md border border-ink-2 bg-surface px-1.5 text-right text-[13px] font-semibold tabular-nums aria-[invalid=true]:border-danger"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish();
        }
      }}
      onFocus={() => onAway(false)}
      // Leaving the field untouched changes nothing (a prefilled estimate is not pinned); Enter confirms it.
      onBlur={() => {
        onAway(true);
        if (draft === initial) finish();
        else commit();
      }}
      // Selecting text in the field is not a drag of the row.
      onPointerDown={(e) => e.stopPropagation()}
    />
    {invalid && (
      <p id={errorId} role="alert" className="w-36 text-right text-[12px] font-medium leading-snug text-danger">
        {t("timeInvalid")}
      </p>
    )}
    </>
  );
}

/** The right-hand column: the set time (bold), an estimate ("≈ 11:20", muted) or "Set a time"; then the stay. */
function When({
  place,
  name,
  timing,
  onSetTime,
  editing,
  setEditing,
  onAway,
}: {
  place: PlaceView;
  name: string;
  timing?: TimelineEntry;
  onSetTime: ((time: string | null) => void) | null;
  /** The time field is open (the row publishes that it is being edited while focus is in it). */
  editing: boolean;
  setEditing(editing: boolean): void;
  onAway(away: boolean): void;
}) {
  const t = useTranslations("trip");
  const stay = useStay();
  const arrive = timing?.arrive ?? null;
  const estimated = arrive !== null && timing!.estimated;
  const shown = arrive === null ? null : estimated ? (
    <>
      <Approximate />
      {arrive}
    </>
  ) : (
    arrive
  );
  const look = estimated || arrive === null ? "font-normal text-ink-2" : "font-semibold";

  let time;
  if (editing && onSetTime)
    time = (
      <TimeInput
        place={place}
        name={name}
        // An estimate is where the time starts: confirming it sets it.
        initial={place.time ?? arrive ?? ""}
        onAway={onAway}
        onDone={(value) => {
          setEditing(false);
          if (value !== undefined && value !== place.time) onSetTime(value);
          focusLater(placeTimeId(place.id));
        }}
      />
    );
  else if (onSetTime)
    time = (
      <button
        type="button"
        id={placeTimeId(place.id)}
        data-testid="place-time"
        aria-label={
          arrive === null ? t("setTimeFor", { name }) : estimated ? t("setTimeForEstimated", { name, time: arrive }) : t("changeTimeFor", { name, time: arrive })
        }
        onClick={() => setEditing(true)}
        className={`whitespace-nowrap rounded-md px-1 text-[13px] tabular-nums hover:bg-hover max-lg:relative max-lg:z-[1] max-lg:-my-3 max-lg:min-h-11 max-lg:min-w-11 ${arrive === null ? "text-[12.5px] text-ink-2 underline underline-offset-2" : look}`}
      >
        {shown ?? t("setTime")}
      </button>
    );
  else
    time = shown && (
      <span data-testid="place-time" className={`whitespace-nowrap px-1 text-[13px] tabular-nums ${look}`}>
        {shown}
      </span>
    );

  return (
    <div className="grid justify-items-end gap-0.5 text-right">
      {time}
      <span className="whitespace-nowrap px-1 text-[12px] text-ink-2">{stay(place.stayMinutes)}</span>
    </div>
  );
}

/** A small amber line under a stop's sub-line (and in its details). */
export function WarnLine({ text }: { text: string }) {
  return (
    <p className="mt-0.5 flex min-w-0 items-start gap-1 text-[12px] font-medium leading-snug text-warn-ink">
      <Icon name="warn" size={13} className="mt-px" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

/**
 * One stop on one line (spec §2): number in the day colour, category glyph, name, a muted sub-line
 * (category · tags, or its note), and on the right its time and stay; under the sub-line, a late
 * arrival or an opening-hours warning. Clicking the row (or Enter on its name) selects it and opens
 * its details panel (PlaceDetails); Alt+↑/↓ on the name reorders. A peer editing it outlines it in
 * their colour. The whole row drags (pointer); every drag has a keyboard way (Alt+↑/↓, and Move up/down
 * and Move to… in the details).
 */
export function StopRow({
  place,
  number,
  colour,
  timing,
  late,
  warning,
  dimmed,
  selected,
  open,
  highlighted = false,
  hovered = false,
  onHover,
  onOpen,
  actions,
  trailing,
  below,
  travelBefore,
}: {
  place: PlaceView;
  /** Stop number within a day; none in Ideas. */
  number?: number;
  /** The day's colour (number badge). */
  colour: string;
  timing?: TimelineEntry;
  /** Arriving after the set time: by how many minutes, from which stop. */
  late?: { minutes: number; from: string } | null;
  warning?: StopWarning;
  dimmed: boolean;
  selected: boolean;
  /** The place's details panel is open. */
  open: boolean;
  /** Just added: highlighted for a moment (a colour fade, none under reduced motion). */
  highlighted?: boolean;
  /** Its pin (or the row itself) is hovered. */
  hovered?: boolean;
  /** The pointer (mouse or pen) went onto the row, or off it (null): its pin is highlighted meanwhile. */
  onHover?(id: string | null): void;
  onOpen(id: string, open: boolean): void;
  actions: StopActions | null;
  /** In place of the time and stay (an idea's "Add to day…"). */
  trailing?: ReactNode;
  /** Under the row, inside it (an idea's add-to-day step). */
  below?: ReactNode;
  /** The travel from the stop before, read first (the dotted connector that shows it is not a list item). */
  travelBefore?: ReactNode;
}) {
  const t = useTranslations("trip");
  const tc = useTranslations("categories");
  const [timeOpen, setTimeOpen] = useState(false);
  // Focus left an open time field (an invalid time keeps it open): not "being edited" for others meanwhile.
  const [timeAway, setTimeAway] = useState(false);
  const name = place.name || t("unnamed");
  const collab = useCollab();
  const note = collab && noteOrNull(() => placeNote(collab.doc, place.id));
  const hasNote = note !== null && noteFirstLine(note) !== "";
  const peer = useEditingPeer(place.id);
  // One publisher per place: its details panel (with its note) and the row's time field together.
  usePublishEditing(place.id, actions !== null && (open || (timeOpen && !timeAway)));
  const { setNodeRef: setDragRef, listeners, isDragging } = useDraggable({ id: place.id, disabled: !actions });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: placeDropId(place.id), disabled: !actions });

  const sub = [tc(place.category), place.tags.length > 0 ? place.tags.join(", ") : hasNote ? t("noteCount", { count: 1 }) : null].filter(Boolean).join(" · ");
  const onKeyDown = (e: KeyboardEvent) => {
    if (!actions || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    actions.nudge(place.id, e.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <li
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      id={placeRowId(place.id)}
      data-dimmed={dimmed || undefined}
      data-highlighted={highlighted || undefined}
      data-hovered={hovered || undefined}
      aria-current={selected || undefined}
      style={{ ...(selected || (isOver && !isDragging) ? { borderColor: colour, boxShadow: `0 0 0 3px ${colour}33` } : {}), ...editingOutline(peer) }}
      // Mouse and pen only: a finger has no hover.
      onPointerEnter={(e) => e.pointerType !== "touch" && onHover?.(place.id)}
      onPointerLeave={(e) => e.pointerType !== "touch" && onHover?.(null)}
      // Pointer selection for the map; the list itself is the accessible view of the trip.
      onClick={(e) => {
        if (!(e.target instanceof Element && e.target.closest(CONTROLS)) && !open) onOpen(place.id, true);
      }}
      // Dimmed by filters: a quieter row whose text keeps AA contrast (no opacity on text).
      className={`relative min-w-0 rounded-xl border border-line motion-safe:transition-colors motion-safe:duration-700 ${highlighted ? "bg-warn-bg" : dimmed ? "bg-line-2" : hovered ? "bg-hover" : "bg-surface"} ${isDragging ? "opacity-40" : ""}`}
    >
      {travelBefore && <span className="sr-only">{travelBefore}. </span>}
      {peer && <EditingTag peer={peer} />}
      <div
        {...listeners}
        className="grid min-w-0 cursor-pointer grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 max-lg:py-3"
      >
        {number !== undefined ? (
          <span aria-hidden="true" className="grid size-[26px] place-items-center rounded-full text-[12px] font-semibold text-white" style={{ background: colour }}>
            {number}
          </span>
        ) : (
          <span aria-hidden="true" className="mx-auto size-2.5 rounded-full bg-[#78716c]" />
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <CategoryGlyph category={place.category} label={tc(place.category)} />
            <button
              type="button"
              id={placeFocusId(place.id)}
              aria-expanded={open}
              aria-keyshortcuts={actions ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
              onClick={() => onOpen(place.id, !open)}
              onKeyDown={onKeyDown}
              className="min-w-0 rounded text-left text-[14px] font-semibold leading-snug max-lg:relative max-lg:z-[1] max-lg:-my-3 max-lg:min-h-11"
            >
              <span data-testid="place-name" title={name} className="block min-w-0 truncate">
                {name}
              </span>
            </button>
          </div>
          <p className="flex min-w-0 items-baseline gap-1.5 text-[12.5px] text-ink-2">
            {number !== undefined && <span className="sr-only">{`${number}. `}</span>}
            <span data-testid="place-sub" className="min-w-0 truncate">
              {sub}
            </span>
            {dimmed && <span className="shrink-0 font-medium">{t("hiddenByFilters")}</span>}
          </p>
          {late && <WarnLine text={t("late", { minutes: late.minutes, place: late.from })} />}
          {warning && <HoursWarning {...warning} />}
        </div>
        {trailing ?? (
          <When
            place={place}
            name={name}
            timing={timing}
            onSetTime={actions && ((time) => actions.setTime(place.id, time))}
            editing={timeOpen}
            setEditing={(editing) => {
              setTimeOpen(editing);
              setTimeAway(false);
            }}
            onAway={setTimeAway}
          />
        )}
      </div>
      {below}

    </li>
  );
}

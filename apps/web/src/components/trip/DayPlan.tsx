"use client";

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useDroppable, type Announcements } from "@dnd-kit/core";
import { useLocale, useTranslations } from "next-intl";
import { DAY_TITLE_MAX, dayNote, dayTimeline, dayUrls, type DayPatch, type DayView, type PlaceView, type Slot, type TripView } from "@rota/trip";
import type { StopWarning } from "@/client/useHours";
import type { Travel } from "@/client/useTravel";
import { dayColour } from "../map/mapFeatures";
import { CommitInput } from "./CommitInput";
import { Connector } from "./Connector";
import { FilterPopover, HiddenCount } from "./FilterPopover";
import { GoogleMapsPin, Icon } from "./icons";
import { NoteEditor, noteOrNull } from "./NoteEditor";
import { EditingTag, editingOutline, useCollab, useEditingPeer, usePublishEditing } from "./Presence";
import { SearchBar, type NewStop, type PreviewPlace } from "./SearchBar";
import { StopRow, type StopActions } from "./StopRow";
import { IdeasView, type RowProps, type Schedule } from "./IdeasView";
import type { SuggestionActions } from "./Suggestions";
import { Approximate, useDuration } from "./TravelLeg";
import { listDropId, plannedLists, type Filter, type ListId } from "./plan";
import type { TripViewState } from "./view";

/**
 * dnd-kit's own screen reader output (an assertive live region with English "Picked up draggable item
 * <id>" messages, and keyboard instructions for a keyboard sensor this screen does not use) is silenced
 * and rendered into a detached element. Dragging is pointer-only; keyboard and screen reader users move
 * places with Alt+↑/↓ and the details panel's Move up/down and Move to…, and others' moves come from the Announcer.
 * The checklist does the same.
 */
export const SILENT: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

export type PlanActions = StopActions &
  SuggestionActions & {
    /** Moves within a list (drag onto a row, Alt+↑/↓, Move up/down): a timed stop is re-timed for its slot. */
    move(id: string, to: { dayId: ListId } & Slot): boolean;
    /** Moves to another list (Move to…): a timed stop keeps its time and goes to its place by time. */
    moveTo(id: string, dayId: ListId): boolean;
    setDay(dayId: string, patch: DayPatch): void;
    /** Moves every set time of a day by `minutes` (one step), saying what happened. */
    shiftTimes(dayId: string, minutes: number): void;
    /** Adds a place to a day or Ideas, or as a suggestion. */
    add(stop: NewStop, to: ListId | "suggest"): void;
    /** Puts an idea into a day at a time (or untimed), with its stay: one step. */
    schedule: Schedule;
  };

/** The day plan's views (the checklist has its own). */
export type PlanView = Exclude<TripViewState, { kind: "checklist" }>;

/** The steps "Shift times" offers, in minutes (spec §2). */
export const SHIFT_STEPS = [-60, -30, -15, 15, 30, 60] as const;

/** "+30" / "−15": a signed number of minutes, with a real minus sign. */
export const signedMinutes = (minutes: number) => `${minutes < 0 ? "−" : "+"}${Math.abs(minutes)}`;

/**
 * "Shift times" and its popover of steps (−60 … +60 min). Non-modal, like the Filter popover: Escape or a
 * press elsewhere closes it, and focus goes back to the button. Disabled when the day has no set times.
 */
function ShiftTimes({ day, onShift }: { day: DayView; onShift(minutes: number): void }) {
  const t = useTranslations("trip");
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const timed = day.places.some((p) => p.time !== null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !box.current?.contains(e.target) && !button.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open && timed}
        aria-controls={open && timed ? id : undefined}
        disabled={!timed}
        title={timed ? undefined : t("shiftNoTimes")}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[26px] items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-[12.5px] text-ink hover:bg-hover disabled:cursor-default disabled:text-ink-2 disabled:hover:bg-surface aria-expanded:border-ink"
      >
        <Icon name="clock" size={13} />
        {t("shiftTimes")}
      </button>
      {open && timed && (
        <div
          ref={box}
          id={id}
          role="group"
          aria-label={t("shiftTimesFor", { n: day.index + 1 })}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            close();
          }}
          className="absolute left-0 top-full z-30 mt-1.5 flex w-max max-w-[calc(100vw-32px)] flex-wrap gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-2"
        >
          {SHIFT_STEPS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-label={minutes < 0 ? t("shiftEarlier", { minutes: -minutes }) : t("shiftLater", { minutes })}
              onClick={() => {
                close();
                onShift(minutes);
              }}
              className="inline-flex h-8 items-center rounded-lg px-2.5 text-[13px] font-medium tabular-nums text-ink hover:bg-hover"
            >
              {t("shiftBy", { minutes: signedMinutes(minutes) })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The day's title, edited in place (saved on Enter or when left); plain text when read-only. */
function DayTitle({ day, onDay }: { day: DayView; onDay: ((patch: DayPatch) => void) | null }) {
  const t = useTranslations("trip");
  if (!onDay) return day.title ? <p className="mt-1 truncate pl-[22px] text-[15px] font-medium text-ink">{day.title}</p> : null;
  return (
    <CommitInput
      value={day.title}
      onCommit={(title) => onDay({ title })}
      maxLength={DAY_TITLE_MAX}
      placeholder={t("dayTitlePlaceholder")}
      aria-label={t("dayTitleFor", { n: day.index + 1 })}
      className="mt-1 ml-[18px] h-8 w-[calc(100%-18px)] min-w-0 rounded-md border border-transparent bg-transparent px-1 text-[15px] font-medium text-ink placeholder:text-ink-2 hover:border-line focus:border-ink-2 focus:bg-surface"
    />
  );
}

/** Walk/drive, the day's total travel, when it ends, and Google Maps directions (one link per part of a long day). */
function DayHeader({
  day,
  headingId,
  travel,
  end,
  onDay,
  onShift,
}: {
  day: DayView;
  headingId: string;
  travel?: Travel;
  end: { time: string; nextDay: boolean } | null;
  onDay: ((patch: DayPatch) => void) | null;
  onShift: ((minutes: number) => void) | null;
}) {
  const t = useTranslations("trip");
  const locale = useLocale();
  const duration = useDuration();
  const urls = dayUrls(day, day.travelMode);
  const date = day.date ? new Date(`${day.date}T00:00:00Z`) : null;
  const weekday = date ? new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date) : "";
  const short = date ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(date) : "";
  const chip = "inline-flex h-[26px] items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-[12.5px] text-ink-2";
  return (
    <div className="px-5 pb-2.5 pt-4">
      <h2 id={headingId} className="flex min-w-0 items-center gap-2.5 font-serif text-[22px] font-semibold leading-tight">
        <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: dayColour(day.index) }} />
        <span className="min-w-0">
          {weekday ? t("dayTitle", { n: day.index + 1, weekday }) : t("day", { n: day.index + 1 })}{" "}
          <span className="font-sans text-[13px] font-normal text-ink-2">{short}</span>
        </span>
      </h2>
      <DayTitle day={day} onDay={onDay} />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label={t("travelMode", { n: day.index + 1 })} className="inline-flex h-[26px] items-center rounded-full border border-line bg-surface p-0.5 text-[12.5px] text-ink-2">
          {(["walk", "drive"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={day.travelMode === mode}
              disabled={!onDay}
              onClick={() => onDay?.({ travelMode: mode })}
              className="inline-flex h-[20px] items-center gap-1 rounded-full px-2 aria-pressed:bg-ink aria-pressed:text-white disabled:cursor-default"
            >
              <Icon name={mode === "walk" ? "walk" : "car"} size={13} />
              {t(mode)}
            </button>
          ))}
        </div>
        {travel && travel.totalSeconds > 0 && (
          <span data-testid="travel-total" className={chip}>
            {travel.anyApproximate && <Approximate />}
            {t("travelTotal", { duration: duration(travel.totalSeconds) })}
          </span>
        )}
        {end && <span className={chip}>{t(end.nextDay ? "dayEndsNextDay" : "dayEnds", { time: end.time })}</span>}
        {onShift && <ShiftTimes day={day} onShift={onShift} />}
        {urls.map((url, i) => (
          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={`${chip} text-ink hover:bg-hover`}>
            <GoogleMapsPin />
            {urls.length === 1 ? t("openDay") : t("openDayPart", { part: i + 1, total: urls.length })}
            <span className="sr-only"> ({t("newTab")})</span>
            <Icon name="ext" size={12} className="text-ink-2" />
          </a>
        ))}
      </div>
    </div>
  );
}

/** The day's shared note; outlined in a friend's colour while they edit it. */
function DayNote({ day, title, editable }: { day: DayView; title: string; editable: boolean }) {
  const collab = useCollab();
  const [open, setOpen] = useState(false);
  const peer = useEditingPeer(day.id);
  usePublishEditing(day.id, editable && open);
  const note = collab && noteOrNull(() => dayNote(collab.doc, day.id));
  if (!note) return null;
  return (
    <div className="relative mx-5 mb-2.5 rounded-lg" style={editingOutline(peer)}>
      {peer && <EditingTag peer={peer} />}
      <NoteEditor fragment={note} awareness={collab?.awareness ?? null} name={title} editable={editable} onOpenChange={setOpen} lines={2} more />
    </div>
  );
}

/** A day's stops with connectors between them; also a drop target (its end). */
function StopList({ day, places, travel, empty, rows }: { day: DayView; places: PlaceView[]; travel?: Travel; empty: string; rows: RowProps }) {
  const t = useTranslations("trip");
  const { setNodeRef, isOver } = useDroppable({ id: listDropId(day.id), disabled: !rows.actions });
  const timeline = dayTimeline(day, travel?.legs ?? []);
  const colour = dayColour(day.index);
  return (
    <div ref={setNodeRef} className={`mx-5 min-w-0 rounded-xl ${isOver ? "bg-hover outline-2 outline-dashed outline-ink-2" : ""}`}>
      {places.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-4 text-[13px] text-ink-2">{empty}</p>
      ) : (
        <ol className="grid min-w-0">
          {places.map((place, i) => {
            const leg = i > 0 ? travel?.legs[i - 1] : undefined;
            const entry = timeline[i];
            // A late arrival is only worth saying once the travel before it is known: not from a
            // straight-line guess while the route is still on its way.
            const guessing = leg?.approximate && travel?.loading;
            const late = entry?.lateBy && !guessing ? { minutes: entry.lateBy, from: places[i - 1]?.name || t("unnamed") } : null;
            return (
              <Fragment key={place.id}>
                {i > 0 && <Connector leg={leg} mode={day.travelMode} />}
                <StopRow
                  place={place}
                  number={i + 1}
                  colour={colour}
                  timing={entry}
                  late={late}
                  warning={rows.warnings.get(place.id)}
                  dimmed={!rows.visible(place)}
                  selected={place.id === rows.selectedId}
                  open={place.id === rows.openId}
                  highlighted={place.id === rows.highlightId}
                  hovered={place.id === rows.hoveredId}
                  onHover={rows.onHover}
                  onOpen={rows.onOpen}
                  actions={rows.actions}
                />
              </Fragment>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * The plan column (spec §2): for a day, its header (walk/drive and travel, end time, Google Maps), one
 * search bar with the Filter button, and the stops as one-line rows with travel between them; for
 * Ideas, Ideas & votes (IdeasView); for the whole trip, every day's header and stops, then Ideas & votes.
 */
export function DayPlan({
  view,
  shown,
  travel,
  warnings,
  filter,
  onFilter,
  hidden,
  visible,
  selectedId,
  openId,
  onOpen,
  actions,
  stopActions,
  onSchedule,
  full,
  near,
  listLabel,
  dayDate,
  userId,
  highlightId = null,
  onPreview,
  hoveredId = null,
  onHover,
}: {
  view: TripView;
  shown: PlanView;
  /** Each day's travel, by day id. */
  travel: Record<string, Travel>;
  /** Opening-hours warnings by place id. */
  warnings: Map<string, StopWarning>;
  filter: Filter;
  onFilter(f: Filter): void;
  /** How many planned places the filters hide. */
  hidden: number;
  visible: (p: PlaceView) => boolean;
  /** The place selected in the list or on the map. */
  selectedId: string | null;
  /** The place whose details panel is open. */
  openId: string | null;
  /** Opens (or closes) a place's details. */
  onOpen(id: string, open: boolean): void;
  actions: PlanActions | null;
  /** What rows can do (see usePlaceControls). */
  stopActions: StopActions | null;
  /** Puts an idea into a day (see usePlaceControls); null while the user cannot edit. */
  onSchedule: Schedule | null;
  full: boolean;
  near: { lat: number; lng: number } | null;
  listLabel: (list: ListId) => string;
  dayDate: (date: string) => string;
  /** The signed-in member (their votes), when known. */
  userId: string | null;
  /** A place just added: its row is highlighted for a moment. */
  highlightId?: string | null;
  /** A search result hovered or arrowed to, for the map's preview pin. */
  onPreview?(place: PreviewPlace | null): void;
  /** The place hovered in the list or on the map (its row is highlighted). */
  hoveredId?: string | null;
  /** The pointer went onto a row, or off it (null). */
  onHover?(id: string | null): void;
}) {
  const t = useTranslations("trip");
  const headingBase = useId();
  const lists = plannedLists(view);
  const listChoiceLabel = (id: ListId) => (id === null ? t("ideas") : `${listLabel(id)} · ${dayDate(view.days.find((d) => d.id === id)!.date)}`);
  const choices = lists.map((l) => ({ id: l.id, label: listChoiceLabel(l.id) }));
  const rows: RowProps = { visible, warnings, selectedId, openId, highlightId, hoveredId, onHover, onOpen, actions: stopActions };

  const filterButton = <FilterPopover view={view} filter={filter} onChange={onFilter} />;
  const shownDay = shown.kind === "day" ? view.days.find((d) => d.id === shown.dayId) : undefined;
  // Where the search bar adds: the day shown; the first day for the whole trip; else Ideas.
  const targetDay = shownDay ?? (shown.kind === "all" ? view.days[0] : undefined);
  const search = (
    <>
      <SearchBar
        key={targetDay?.id ?? "ideas"}
        target={{ id: targetDay?.id ?? null, label: targetDay ? listLabel(targetDay.id) : t("ideas") }}
        day={targetDay}
        legs={targetDay ? (travel[targetDay.id]?.legs ?? []) : []}
        full={full}
        near={near}
        filter={filterButton}
        onAdd={actions && ((stop, to) => actions.add(stop, to))}
        onPreview={onPreview}
      />
      <HiddenCount hidden={hidden} />
    </>
  );

  const daySection = (day: DayView, extra?: ReactNode) => {
    const headingId = `${headingBase}-${day.id}`;
    const dayTravel = travel[day.id];
    const last = dayTimeline(day, dayTravel?.legs ?? []).at(-1);
    const end = last?.leave ? { time: last.leave, nextDay: last.overflowDays > 0 } : null;
    return (
      <section key={day.id} aria-labelledby={headingId} className="min-w-0 pb-3">
        <DayHeader
          day={day}
          headingId={headingId}
          travel={dayTravel}
          end={end}
          onDay={actions && ((patch) => actions.setDay(day.id, patch))}
          onShift={actions && ((minutes) => actions.shiftTimes(day.id, minutes))}
        />
        {/* The day's note at the top, under its header (spec §2). */}
        <DayNote day={day} title={listLabel(day.id)} editable={actions !== null} />
        {extra}
        <StopList day={day} places={day.places} travel={dayTravel} empty={t("dayEmpty")} rows={rows} />
      </section>
    );
  };

  const days = view.days.map((d) => ({ id: d.id, label: listChoiceLabel(d.id), name: listLabel(d.id) }));
  const ideas = (extra?: ReactNode) => (
    <IdeasView
      view={view}
      travel={travel}
      rows={rows}
      search={extra}
      suggestionActions={actions}
      onSchedule={onSchedule}
      userId={userId}
      lists={choices}
      dayChoices={days}
    />
  );

  return (
    <>
      {shown.kind === "day" && shownDay && daySection(shownDay, search)}
      {shown.kind === "ideas" && ideas(search)}
      {shown.kind === "all" && (
        <>
          <div className="pt-3">{search}</div>
          {view.days.map((day) => daySection(day))}
          {ideas()}
        </>
      )}
      {shown.kind === "day" && <p className="px-5 pb-2 text-[12px] text-ink-2">{t("planHint")}</p>}
    </>
  );
}

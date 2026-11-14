"use client";

import { Fragment, useId, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { dayNote, dayUrls, type DayPatch, type DayView, type MemberView, type PlaceView, type TimelineEntry } from "@rota/trip";
import type { StopWarning } from "@/client/useHours";
import type { Travel } from "@/client/useTravel";
import type { DayWeather } from "@/client/useWeather";
import { btn, btnSm } from "../ui";
import { GoogleMapsPin, Icon } from "./icons";
import { NoteEditor, noteOrNull } from "./NoteEditor";
import { PlaceRow, type PlaceActions } from "./PlaceRow";
import { EditingTag, editingOutline, useCollab, useEditingPeer, usePublishEditing } from "./Presence";
import { listDropId } from "./plan";
import { Approximate, TravelLeg, useDuration } from "./TravelLeg";
import { WeatherChip } from "./WeatherChip";

/** A day's travel mode and total, and Google Maps directions (one link per part of a long day). */
function DayControls({ day, travel, onDay }: { day: DayView; travel?: Travel; onDay: ((patch: DayPatch) => void) | null }) {
  const t = useTranslations("trip");
  const duration = useDuration();
  const urls = dayUrls(day, day.travelMode);
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5 text-[12.5px] text-ink-2">
      <div role="group" aria-label={t("travelMode", { n: day.index + 1 })} className="inline-flex rounded-[7px] border border-line bg-surface p-0.5">
        {(["walk", "drive"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={day.travelMode === mode}
            disabled={!onDay}
            onClick={() => onDay?.({ travelMode: mode })}
            className="inline-flex h-[22px] items-center gap-1 rounded-[5px] px-2 aria-pressed:bg-ink aria-pressed:text-white disabled:cursor-default"
          >
            <Icon name={mode === "walk" ? "walk" : "car"} size={14} />
            {t(mode)}
          </button>
        ))}
      </div>
      {travel && travel.totalSeconds > 0 && (
        <span data-testid="travel-total" className="font-mono text-[12px]">
          {travel.anyApproximate && <Approximate />}
          {t("travelTotal", { duration: duration(travel.totalSeconds) })}
        </span>
      )}
      {urls.map((url, i) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={`${btn} ${btnSm}`}>
          <GoogleMapsPin />
          {urls.length === 1 ? t("openDay") : t("openDayPart", { part: i + 1, total: urls.length })}
          <span className="sr-only"> ({t("newTab")})</span>
          <Icon name="ext" size={12} className="text-ink-2" />
        </a>
      ))}
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
    <div className="relative mx-4 mb-2.5 rounded-lg" style={editingOutline(peer)}>
      {peer && <EditingTag peer={peer} />}
      <NoteEditor fragment={note} awareness={collab?.awareness ?? null} name={title} editable={editable} onOpenChange={setOpen} />
    </div>
  );
}

/** A day (or Ideas, without `day`): heading, controls, and its places in order. Also a drop target. */
export function DaySection({
  day,
  title,
  subtitle,
  places,
  timeline,
  travel,
  warnings,
  weather,
  visible,
  selectedId,
  onSelect,
  members,
  actions,
  onDay,
}: {
  day?: DayView;
  title: string;
  subtitle?: string;
  places: PlaceView[];
  timeline?: TimelineEntry[];
  travel?: Travel;
  /** Opening-hours warnings by place id. */
  warnings?: Map<string, StopWarning>;
  weather?: DayWeather;
  visible: (p: PlaceView) => boolean;
  selectedId: string | null;
  onSelect(id: string): void;
  members: MemberView[];
  actions: PlaceActions | null;
  onDay: ((patch: DayPatch) => void) | null;
}) {
  const t = useTranslations("trip");
  const headingId = useId();
  const { setNodeRef, isOver } = useDroppable({ id: listDropId(day?.id ?? null), disabled: !actions });
  const arrivals = new Map(timeline?.flatMap((e) => (e.arrive === null ? [] : [[e.placeId, { time: e.arrive, estimated: e.estimated }] as const])));
  return (
    <section aria-labelledby={headingId} className="pb-2">
      <div className="flex flex-wrap items-center gap-x-2 px-4 pb-2.5 pt-3.5">
        <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold tracking-[-0.01em]">
          {title}
          {subtitle && " "}
          {subtitle && <span className="text-[13px] font-normal text-ink-2">{subtitle}</span>}
        </h2>
        {weather && (
          <span className="ml-auto">
            <WeatherChip weather={weather} />
          </span>
        )}
      </div>
      {day && <DayControls day={day} travel={travel} onDay={onDay} />}
      {day && <DayNote day={day} title={title} editable={onDay !== null} />}
      <div ref={setNodeRef} className={`mx-3 rounded-xl ${isOver ? "bg-hover outline-2 outline-dashed outline-ink-2" : ""}`}>
        {places.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-[13px] text-ink-2">{day ? t("dayEmpty") : t("ideasEmpty")}</p>
        ) : (
          <ol className="grid gap-2">
            {places.map((place, i) => {
              const leg = day && i > 0 ? travel?.legs[i - 1] : null;
              return (
                <Fragment key={place.id}>
                  {leg && <TravelLeg leg={leg} mode={day!.travelMode} />}
                  <PlaceRow
                    place={place}
                    number={day ? i + 1 : undefined}
                    first={i === 0}
                    last={i === places.length - 1}
                    arrival={arrivals.get(place.id)}
                    warning={warnings?.get(place.id)}
                    dimmed={!visible(place)}
                    selected={place.id === selectedId}
                    onSelect={onSelect}
                    members={members}
                    actions={actions}
                  />
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

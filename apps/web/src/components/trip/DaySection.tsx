"use client";

import { useId } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { dayUrls, type DayPatch, type DayView, type MemberView, type PlaceView, type TimelineEntry } from "@rota/trip";
import { btn, btnSm } from "../ui";
import { CommitInput } from "./CommitInput";
import { GoogleMapsPin, Icon } from "./icons";
import { PlaceRow, type PlaceActions } from "./PlaceRow";
import { listDropId } from "./plan";

const segment = "inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2";

/** A day's start time, travel mode and Google Maps directions (one link per part of a long day). */
function DayControls({ day, title, onDay }: { day: DayView; title: string; onDay: ((patch: DayPatch) => void) | null }) {
  const t = useTranslations("trip");
  const id = useId();
  const urls = dayUrls(day, day.travelMode);
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5 text-[12.5px] text-ink-2">
      <label htmlFor={id} className={segment}>
        <Icon name="clock" size={14} />
        {t("startTime")}
        <span className="sr-only">, {title}</span>
        <CommitInput
          id={id}
          type="time"
          value={day.startTime}
          readOnly={!onDay}
          className="bg-transparent font-mono text-[12px] text-ink"
          onCommit={(startTime) => onDay?.({ startTime })}
        />
      </label>
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

/** A day (or Ideas, without `day`): heading, controls, and its places in order. Also a drop target. */
export function DaySection({
  day,
  title,
  subtitle,
  places,
  timeline,
  visible,
  members,
  actions,
  onDay,
}: {
  day?: DayView;
  title: string;
  subtitle?: string;
  places: PlaceView[];
  timeline?: TimelineEntry[];
  visible: (p: PlaceView) => boolean;
  members: MemberView[];
  actions: PlaceActions | null;
  onDay: ((patch: DayPatch) => void) | null;
}) {
  const t = useTranslations("trip");
  const headingId = useId();
  const { setNodeRef, isOver } = useDroppable({ id: listDropId(day?.id ?? null), disabled: !actions });
  const arrivals = new Map(timeline?.map((e) => [e.placeId, e.arrive]));
  return (
    <section aria-labelledby={headingId} className="pb-2">
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-2 px-4 pb-2.5 pt-3.5 text-[15px] font-semibold tracking-[-0.01em]">
        {title}
        {subtitle && " "}
        {subtitle && <span className="text-[13px] font-normal text-ink-2">{subtitle}</span>}
      </h2>
      {day && <DayControls day={day} title={title} onDay={onDay} />}
      <div ref={setNodeRef} className={`mx-3 rounded-xl ${isOver ? "bg-hover outline-2 outline-dashed outline-ink-2" : ""}`}>
        {places.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-[13px] text-ink-2">{day ? t("dayEmpty") : t("ideasEmpty")}</p>
        ) : (
          <ol className="grid gap-2">
            {places.map((place, i) => (
              <PlaceRow
                key={place.id}
                place={place}
                number={day ? i + 1 : undefined}
                first={i === 0}
                last={i === places.length - 1}
                arrival={arrivals.get(place.id)}
                dimmed={!visible(place)}
                members={members}
                actions={actions}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

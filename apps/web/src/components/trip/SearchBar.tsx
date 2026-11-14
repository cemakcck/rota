"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_STAY_MINUTES, estimateLeg, suggestTime, type Category, type DayView, type Leg } from "@rota/trip";
import type { SearchResult } from "@/client/geocode";
import { btn, btnPrimary, btnSm, errorText, hint } from "../ui";
import { Icon } from "./icons";
import { PlaceSearch } from "./PlaceSearch";
import { parseTime, type ListId } from "./plan";

/** What the add step adds: a searched place with its coordinates, OSM id and address, or just a name; with its time and stay. */
export type NewStop = { name: string; category: Category; lat?: number; lng?: number; osmId?: string; address?: string; time: string | null; stayMinutes: number };
type Candidate = Omit<NewStop, "time" | "stayMinutes">;

/**
 * The time suggested for a new last stop of `day`: the last stop's end plus travel to the new place
 * (estimated when both have coordinates, else none); empty when nothing timed comes before.
 */
function suggestedFor(day: DayView | undefined, legs: readonly (Leg | null)[], place: Candidate): string {
  if (!day) return "";
  const last = day.places.at(-1);
  const toNew =
    last && last.lat !== null && last.lng !== null && place.lat !== undefined && place.lng !== undefined
      ? estimateLeg({ lat: last.lat, lng: last.lng }, { lat: place.lat, lng: place.lng }, day.travelMode)
      : null;
  const all = [...day.places.slice(1).map((_, i) => legs[i] ?? null), toNew];
  return suggestTime(day, all, day.places.length) ?? "";
}

/**
 * The step between choosing a place and adding it (spec §2b): when (prefilled with the suggestion,
 * editable, may be left empty) and for how long (the category's usual stay); then Add to the day (Enter),
 * to Ideas, or as a suggestion. Escape goes back to the search.
 */
function AddStep({
  place,
  target,
  initialTime,
  onAdd,
  onCancel,
}: {
  place: Candidate;
  target: { id: ListId; label: string };
  initialTime: string;
  onAdd: (stop: NewStop, to: ListId | "suggest") => void;
  onCancel: () => void;
}) {
  const t = useTranslations("trip");
  const tc = useTranslations("common");
  const id = useId();
  const timeRef = useRef<HTMLInputElement>(null);
  const [time, setTime] = useState(initialTime);
  const [stay, setStay] = useState(String(DEFAULT_STAY_MINUTES[place.category]));
  const [invalid, setInvalid] = useState(false);
  const toDay = target.id !== null;

  function add(to: ListId | "suggest") {
    const minutes = Number(stay);
    const stayMinutes = stay.trim() !== "" && Number.isFinite(minutes) ? Math.min(1440, Math.max(0, Math.round(minutes))) : DEFAULT_STAY_MINUTES[place.category];
    // Only a stop in a day has a time; Ideas and suggestions are not scheduled.
    if (to === null || to === "suggest") return onAdd({ ...place, time: null, stayMinutes }, to);
    const parsed = parseTime(time);
    if (parsed === null) {
      setInvalid(true);
      return timeRef.current?.focus();
    }
    onAdd({ ...place, time: parsed || null, stayMinutes }, to);
  }

  return (
    <form
      aria-label={t("addStep", { name: place.name.trim() })}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        add(target.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          add(target.id);
        }
      }}
      className="mx-5 mb-3 grid gap-3 rounded-xl border border-line bg-surface p-3 shadow-1"
    >
      <p className="min-w-0 truncate text-[14px] font-semibold" title={place.name}>
        {place.name}
        {place.address && <span className="ml-1.5 text-[12.5px] font-normal text-ink-2">{place.address}</span>}
      </p>
      <div className="flex flex-wrap items-start gap-3">
        {toDay && (
          <div>
            <label htmlFor={`${id}-time`} className="mb-1 block text-[13px] font-medium">
              {t("time")}
            </label>
            <input
              ref={timeRef}
              id={`${id}-time`}
              autoFocus
              type="text"
              inputMode="numeric"
              placeholder="HH:MM"
              maxLength={5}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${id}-error` : `${id}-hint`}
              className="h-9 w-24 rounded-lg border border-ink-2 bg-surface px-2.5 text-[14px] font-semibold tabular-nums aria-[invalid=true]:border-danger"
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                setInvalid(false);
              }}
            />
          </div>
        )}
        <div>
          <label htmlFor={`${id}-stay`} className="mb-1 block text-[13px] font-medium">
            {t("stayMinutes")}
          </label>
          <input
            id={`${id}-stay`}
            autoFocus={!toDay}
            type="number"
            min={0}
            max={1440}
            step={5}
            inputMode="numeric"
            className="h-9 w-24 rounded-lg border border-ink-2 bg-surface px-2.5 text-[14px] tabular-nums"
            value={stay}
            onChange={(e) => setStay(e.target.value)}
          />
        </div>
      </div>
      {toDay &&
        (invalid ? (
          <p id={`${id}-error`} className={errorText}>
            {t("timeInvalid")}
          </p>
        ) : (
          <p id={`${id}-hint`} className={`${hint} !mt-0`}>
            {t("timeHint")}
          </p>
        ))}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${btnPrimary} ${btnSm}`}>
          {t("addToList", { list: target.label })}
        </button>
        {toDay && (
          <button type="button" className={`${btn} ${btnSm}`} aria-label={t("addToList", { list: t("ideas") })} onClick={() => add(null)}>
            {t("ideas")}
          </button>
        )}
        <button type="button" className={`${btn} ${btnSm}`} onClick={() => add("suggest")}>
          {t("suggest")}
        </button>
        <button type="button" className={`${btn} ${btnSm} ml-auto`} onClick={onCancel}>
          {tc("cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * The one search bar of the plan column: "Add a place to Day N…", with the Filter button at its end.
 * Picking a result, or Enter on typed text (added by name, listed but not pinned), opens the add step.
 * Disabled once the trip is full (soft caps, spec §10).
 */
export function SearchBar({
  target,
  day,
  legs,
  full,
  near,
  filter,
  onAdd,
}: {
  /** Where Add puts it: the day shown (or Ideas), with its label. */
  target: { id: ListId; label: string };
  /** That day, for the suggested time; none for Ideas. */
  day?: DayView;
  /** That day's travel between its stops. */
  legs: readonly (Leg | null)[];
  full: boolean;
  /** Search results are biased towards the trip's area. */
  near: { lat: number; lng: number } | null;
  filter?: ReactNode;
  /** Null when the user cannot edit: the bar is not shown, only the filter. */
  onAdd: ((stop: NewStop, to: ListId | "suggest") => void) | null;
}) {
  const t = useTranslations("trip");
  const tm = useTranslations("map");
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [step, setStep] = useState<{ place: Candidate; time: string } | null>(null);
  const label = t("searchIn", { list: target.label });

  const choose = (place: Candidate) => setStep({ place, time: target.id === null ? "" : suggestedFor(day, legs, place) });
  const back = () => {
    setStep(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!onAdd)
    return filter ? <div className="relative mx-5 mb-3 flex justify-end">{filter}</div> : null;

  return (
    <div className="grid">
      <div className="relative mx-5 mb-3 mt-1.5 flex items-center gap-2.5 rounded-xl border border-line bg-surface py-1 pl-3.5 pr-2 shadow-1 focus-within:border-ink-2">
        <Icon name="search" size={16} className="text-ink-2" />
        <label htmlFor={`${id}-search`} className="sr-only">
          {label}
        </label>
        <div className="min-w-0 flex-1">
          <PlaceSearch
            id={`${id}-search`}
            label={label}
            inputRef={inputRef}
            value={text}
            onValueChange={(v) => {
              setText(v);
              setStep(null);
            }}
            onPick={(r: SearchResult) => choose({ name: r.name, category: r.category, lat: r.lat, lng: r.lng, osmId: r.osmId, address: r.label || undefined })}
            onEnter={() => text.trim() && choose({ name: text.trim(), category: "other" })}
            near={near}
            disabled={full}
            describedBy={full ? `${id}-full` : `${id}-help`}
            placeholder={label}
            inputClassName="h-9 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-2 disabled:cursor-not-allowed"
          />
        </div>
        {filter}
      </div>
      {step && (
        <AddStep
          key={`${step.place.name}|${step.place.osmId ?? ""}`}
          place={step.place}
          target={target}
          initialTime={step.time}
          onCancel={back}
          onAdd={(stop, to) => {
            onAdd(stop, to);
            setText("");
            setStep(null);
            inputRef.current?.focus();
          }}
        />
      )}
      {full ? (
        <p id={`${id}-full`} className="mx-5 -mt-1 mb-3 text-[12.5px] text-ink-2">
          <strong className="font-semibold text-ink">{t("full")}</strong> {t("fullHelp")}
        </p>
      ) : (
        // The map's own way in (TripMap's AddHere) has no visible control, so it is named here.
        <p id={`${id}-help`} className="mx-5 -mt-1.5 mb-2 text-[12px] text-ink-2">
          {tm("addHereHelp")}
        </p>
      )}
    </div>
  );
}

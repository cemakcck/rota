"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CATEGORIES, DEFAULT_STAY_MINUTES, estimateLeg, suggestTime, type Category, type DayView, type Leg } from "@rota/trip";
import type { SearchResult } from "@/client/geocode";
import { btn, btnPrimary, btnSm } from "../ui";
import { CategoryIcon, Icon } from "./icons";
import { PlaceSearch } from "./PlaceSearch";
import type { ListId } from "./plan";
import { stayFrom, timeFrom, TimeStayFields } from "./TimeStayFields";

/** What the add step adds: a searched place with its coordinates, OSM id and address, or just a name; with its time and stay. */
export type NewStop = { name: string; category: Category; lat?: number; lng?: number; osmId?: string; address?: string; time: string | null; stayMinutes: number };
type Candidate = Omit<NewStop, "time" | "stayMinutes">;
/** A search result shown as a preview pin on the map while it is hovered or arrowed to. */
export type PreviewPlace = Pick<SearchResult, "name" | "category" | "lat" | "lng">;

/**
 * The time suggested for a new last stop of `day`: the last stop's end plus travel to the new place
 * (estimated when both have coordinates, else none); empty when nothing timed comes before.
 */
export function suggestedFor(day: DayView | undefined, legs: readonly (Leg | null)[], place: { lat?: number; lng?: number }): string {
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
 * The step between choosing a place and adding it (spec §1, §2b): when (a picker defaulting to the
 * suggestion, may be left without a time), for how long (chips, from the category's usual stay) and
 * the category (suggested by the search, changeable); then Add to the day (Enter), to Ideas, or as a
 * suggestion. Escape goes back to the search.
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
  const tcat = useTranslations("categories");
  const id = useId();
  const timeRef = useRef<HTMLInputElement>(null);
  const [time, setTime] = useState(initialTime);
  const [category, setCategory] = useState<Category>(place.category);
  const [stay, setStay] = useState(String(DEFAULT_STAY_MINUTES[place.category]));
  // The stay follows the category until one is chosen.
  const [stayChosen, setStayChosen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const toDay = target.id !== null;

  function add(to: ListId | "suggest") {
    const stayMinutes = stayFrom(stay, DEFAULT_STAY_MINUTES[category]);
    const stop = { ...place, category };
    // Only a stop in a day has a time; Ideas and suggestions are not scheduled.
    if (to === null || to === "suggest") return onAdd({ ...stop, time: null, stayMinutes }, to);
    const parsed = timeFrom(time, timeRef.current);
    if (parsed === null) {
      setInvalid(true);
      return timeRef.current?.focus();
    }
    onAdd({ ...stop, time: parsed || null, stayMinutes }, to);
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
      <p className="flex min-w-0 items-center gap-2 text-[14px] font-semibold" title={place.name}>
        <CategoryIcon category={category} label={tcat(category)} small />
        <span className="min-w-0 truncate">
          {place.name}
          {place.address && <span className="ml-1.5 text-[12.5px] font-normal text-ink-2">{place.address}</span>}
        </span>
      </p>
      <TimeStayFields
        id={id}
        timeRef={timeRef}
        withTime={toDay}
        time={time}
        suggested={initialTime}
        onTime={(v) => {
          setTime(v);
          setInvalid(false);
        }}
        invalid={invalid}
        stay={stay}
        onStay={(v) => {
          setStay(v);
          setStayChosen(true);
        }}
        after={
          <div>
            <label htmlFor={`${id}-category`} className="mb-1 block text-[13px] font-medium">
              {t("category")}
            </label>
            <select
              id={`${id}-category`}
              className="h-9 max-lg:h-11 max-w-[180px] rounded-lg border border-ink-2 bg-surface px-2 text-[14px]"
              value={category}
              onChange={(e) => {
                const next = e.target.value as Category;
                setCategory(next);
                if (!stayChosen) setStay(String(DEFAULT_STAY_MINUTES[next]));
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tcat(c)}
                </option>
              ))}
            </select>
          </div>
        }
      />
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
  onPreview,
  query = null,
  onQueryRun,
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
  /** The result hovered or arrowed to, for a preview pin on the map; null when none. */
  onPreview?(place: PreviewPlace | null): void;
  /** A search to run (an empty day's quick search): typed in, its results opened, the field focused. */
  query?: { text: string } | null;
  /** That search has been run (so it is not run again). */
  onQueryRun?(): void;
}) {
  const t = useTranslations("trip");
  const tm = useTranslations("map");
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [step, setStep] = useState<{ place: Candidate; time: string } | null>(null);
  // The map's preview pin: the result hovered or arrowed to, then the picked place while its add step is
  // open, so the pin (and the map, if the preview took it there) stays until it is added or cancelled.
  const [listPreview, setListPreview] = useState<PreviewPlace | null>(null);
  const picked = step?.place;
  const shownPreview: PreviewPlace | null =
    picked && picked.lat != null && picked.lng != null ? { name: picked.name, category: picked.category, lat: picked.lat, lng: picked.lng } : listPreview;
  const previewKey = shownPreview && `${shownPreview.name}|${shownPreview.lat},${shownPreview.lng}`;
  const tellPreview = useEffectEvent((place: PreviewPlace | null) => onPreview?.(place));
  useEffect(() => tellPreview(shownPreview), [previewKey]); // eslint-disable-line react-hooks/exhaustive-deps -- follows the place only
  useEffect(() => () => tellPreview(null), []);
  // The field runs the search (its own effect comes first); here it is focused, so its results stay open.
  const queryRun = useEffectEvent(() => onQueryRun?.());
  useEffect(() => {
    if (!query) return;
    inputRef.current?.focus();
    queryRun();
  }, [query]);
  const label = t("searchIn", { list: target.label });
  // Distances are from the day's last pinned stop, else the trip's destination (or centre).
  const lastPinned = day?.places.findLast((p) => p.lat !== null && p.lng !== null);
  const from = lastPinned ? { lat: lastPinned.lat!, lng: lastPinned.lng! } : near;

  const choose = (place: Candidate) => setStep({ place, time: target.id === null ? "" : suggestedFor(day, legs, place) });
  const back = () => {
    setStep(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!onAdd)
    return filter ? <div className="relative mx-5 mb-3 flex justify-end">{filter}</div> : null;

  return (
    <div className="grid">
      {/* The results list opens under this whole box (360 px in the 400 px column), as wide as it. */}
      <div data-search-box data-tour="search" className="relative mx-5 mb-3 mt-1.5 flex items-center gap-2.5 rounded-xl border border-line bg-surface py-1 pl-3.5 pr-2 shadow-1 focus-within:border-ink-2 has-[input:focus]:outline-2 has-[input:focus]:outline-offset-2 has-[input:focus]:outline-ink">
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
            from={from}
            anchorToParent
            query={query}
            onPreview={(r) => setListPreview(r && { name: r.name, category: r.category, lat: r.lat, lng: r.lng })}
            disabled={full}
            describedBy={full ? `${id}-full` : `${id}-help`}
            placeholder={label}
            inputClassName="h-9 max-lg:h-11 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-2 disabled:cursor-not-allowed"
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
            setText("");
            setStep(null);
            // Here for adding the next one; the plan moves focus to the new row when it is shown.
            inputRef.current?.focus();
            onAdd(stop, to);
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

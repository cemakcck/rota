"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { DEFAULT_STAY_MINUTES, type Category } from "@rota/trip";
import { btn, btnPrimary, btnSm, errorText, hint, input, label } from "../ui";
import { CategoryPicker } from "../trip/CategoryPicker";
import type { ListChoice } from "../trip/MoveDialog";
import type { ListId } from "../trip/plan";
import { stayFrom, timeFrom, TimeStayFields } from "../trip/TimeStayFields";
import type { LngLat } from "./engine";

export type ReverseGeocode = (at: LngLat) => Promise<string | null>;
export type NewMapPlace = {
  name: string;
  category: Category;
  dayId: ListId;
  /** "HH:MM", or null (untimed; always for Ideas). */
  time: string | null;
  stayMinutes: number;
} & LngLat;

/** The time suggested for a new last stop of a day at a point ("" when none). */
export type SuggestAt = (dayId: string, at: LngLat) => string;

/**
 * Adding the place at a point of the map (spec §5, "tap the map"): its name (prefilled by reverse
 * geocoding when available, unless the person already typed one), a category and the day or Ideas;
 * into a day, its time first (spec §2b: prefilled with the suggestion, editable, may be empty) and stay.
 */
export function AddHere({
  at,
  lists,
  defaultList,
  reverseGeocode,
  suggest,
  onAdd,
  onClose,
}: {
  at: LngLat;
  lists: ListChoice[];
  defaultList: ListId;
  reverseGeocode?: ReverseGeocode;
  suggest?: SuggestAt;
  onAdd: (place: NewMapPlace) => void;
  onClose: () => void;
}) {
  const t = useTranslations("trip");
  const tm = useTranslations("map");
  const tc = useTranslations("common");
  const id = useId();
  const [name, setName] = useState("");
  const [lookingUp, setLookingUp] = useState(reverseGeocode !== undefined);
  const [category, setCategory] = useState<Category>("other");
  const [to, setTo] = useState<ListId>(lists.some((l) => l.id === defaultList) ? defaultList : (lists[0]?.id ?? null));
  const [error, setError] = useState(false);
  const typed = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const suggestion = (list: ListId) => (list === null || !suggest ? "" : suggest(list, at));
  // The suggestion follows the chosen day, and the stay the category, until typed in.
  const [time, setTime] = useState(() => suggestion(to));
  const [timeTyped, setTimeTyped] = useState(false);
  const [invalidTime, setInvalidTime] = useState(false);
  const [stay, setStay] = useState(String(DEFAULT_STAY_MINUTES.other));
  const [stayTyped, setStayTyped] = useState(false);

  useEffect(() => {
    if (!reverseGeocode) return;
    let live = true;
    reverseGeocode(at)
      .then((found) => {
        if (live && found && !typed.current) setName(found);
      })
      .catch(() => undefined)
      .finally(() => live && setLookingUp(false));
    return () => {
      live = false;
    };
  }, [at, reverseGeocode]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(true);
      return nameRef.current?.focus();
    }
    const parsed = to === null ? "" : timeFrom(time, timeRef.current);
    if (parsed === null) {
      setInvalidTime(true);
      return timeRef.current?.focus();
    }
    onAdd({ name, category, dayId: to, lat: at.lat, lng: at.lng, time: parsed || null, stayMinutes: stayFrom(stay, DEFAULT_STAY_MINUTES[category]) });
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-3">
          <Dialog.Title className="text-[16px] font-semibold">{tm("addHere")}</Dialog.Title>
          <Dialog.Description className="mt-1 font-mono text-[12px] text-ink-2">
            {at.lat.toFixed(5)}, {at.lng.toFixed(5)}
          </Dialog.Description>
          <form onSubmit={submit} noValidate className="mt-4 grid gap-4">
            <div>
              <label htmlFor={`${id}-name`} className={label}>
                {t("placeName")}
              </label>
              <input
                ref={nameRef}
                id={`${id}-name`}
                className={input}
                value={name}
                maxLength={200}
                autoComplete="off"
                aria-invalid={error || undefined}
                aria-describedby={error ? `${id}-error` : lookingUp ? `${id}-lookup` : undefined}
                onChange={(e) => {
                  typed.current = true;
                  setName(e.target.value);
                }}
              />
              {lookingUp && (
                <p id={`${id}-lookup`} className={hint}>
                  {tm("lookingUp")}
                </p>
              )}
              {error && (
                <p id={`${id}-error`} className={errorText}>
                  {t("editorNameInvalid")}
                </p>
              )}
            </div>
            <CategoryPicker
              name={`${id}-category`}
              value={category}
              onChange={(c) => {
                setCategory(c);
                if (!stayTyped) setStay(String(DEFAULT_STAY_MINUTES[c]));
              }}
            />
            <div>
              <label htmlFor={`${id}-to`} className={label}>
                {t("addTo")}
              </label>
              <select
                id={`${id}-to`}
                className="h-10 max-lg:h-11 w-full rounded-lg border border-ink-2 bg-surface px-2 text-[14px]"
                value={to ?? ""}
                onChange={(e) => {
                  const list = e.target.value || null;
                  setTo(list);
                  setInvalidTime(false);
                  if (!timeTyped) setTime(suggestion(list));
                }}
              >
                {lists.map((l) => (
                  <option key={l.id ?? ""} value={l.id ?? ""}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <TimeStayFields
                id={`${id}-when`}
                timeRef={timeRef}
                withTime={to !== null}
                time={time}
                suggested={suggestion(to)}
                onTime={(v) => {
                  setTime(v);
                  setTimeTyped(true);
                  setInvalidTime(false);
                }}
                invalid={invalidTime}
                stay={stay}
                onStay={(v) => {
                  setStay(v);
                  setStayTyped(true);
                }}
                // The name field comes first here: the time step takes no focus.
                autoFocus={false}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className={`${btn} ${btnSm}`}>
                  {tc("cancel")}
                </button>
              </Dialog.Close>
              <button type="submit" className={`${btnPrimary} ${btnSm}`}>
                {tm("add")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

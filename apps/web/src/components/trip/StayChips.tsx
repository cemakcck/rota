"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** The stays offered as chips, in minutes (spec §1); anything else is Custom…. */
export const STAY_CHIPS = [15, 30, 60, 90, 120, 180] as const;

const isChip = (stay: string) => stay.trim() !== "" && (STAY_CHIPS as readonly number[]).includes(Number(stay));

/**
 * How long to stay: chips (15 min · 30 min · 1 h · 1 h 30 · 2 h · 3 h) and Custom…, which shows a
 * minutes field (0–1440, in 5s). A stay that is not a chip (a café's usual 45 minutes) shows the field.
 */
export function StayChips({ id, value, onChange, autoFocus }: { id: string; value: string; onChange(value: string): void; autoFocus?: boolean }) {
  const t = useTranslations("trip");
  // "15 min", "1 h", "1 h 30" (spec §1).
  const stay = (minutes: number) => {
    const [h, m] = [Math.floor(minutes / 60), minutes % 60];
    return h === 0 ? t("minutesShort", { m }) : m === 0 ? t("hoursOnly", { h }) : t("stayChipHours", { h, m });
  };
  const field = useRef<HTMLInputElement>(null);
  const [customChosen, setCustomChosen] = useState(false);
  // Custom… moves focus to its field once the field is there.
  const focusField = useRef(false);
  useEffect(() => {
    if (!focusField.current) return;
    focusField.current = false;
    field.current?.focus();
  });
  const custom = customChosen || !isChip(value);
  const chip =
    "inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-[12.5px] max-lg:h-11 max-lg:px-3.5 font-medium tabular-nums hover:bg-hover aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white";
  return (
    <div>
      <p id={`${id}-stay-label`} className="mb-1 text-[13px] font-medium">
        {t("stay")}
      </p>
      <div role="group" aria-labelledby={`${id}-stay-label`} className="flex flex-wrap gap-1.5">
        {STAY_CHIPS.map((minutes) => {
          const pressed = !custom && Number(value) === minutes;
          return (
            <button
              key={minutes}
              type="button"
              className={chip}
              aria-pressed={pressed}
              autoFocus={autoFocus && pressed}
              onClick={() => {
                setCustomChosen(false);
                onChange(String(minutes));
              }}
            >
              {stay(minutes)}
            </button>
          );
        })}
        <button
          type="button"
          className={chip}
          aria-pressed={custom}
          onClick={() => {
            setCustomChosen(true);
            if (field.current) field.current.focus();
            else focusField.current = true;
          }}
        >
          {t("customStay")}
        </button>
      </div>
      {custom && (
        <div className="mt-1.5">
          <label htmlFor={`${id}-stay`} className="mb-1 block text-[12.5px] text-ink-2">
            {t("stayMinutes")}
          </label>
          <input
            ref={field}
            id={`${id}-stay`}
            autoFocus={autoFocus}
            type="number"
            min={0}
            max={1440}
            step={5}
            inputMode="numeric"
            className="h-9 w-24 rounded-lg border border-ink-2 bg-surface px-2.5 text-[14px] tabular-nums max-lg:h-11"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

"use client";

import { useSyncExternalStore, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { parseTime } from "./plan";

const COARSE = "(pointer: coarse)";
const LAST_MINUTE = 23 * 60 + 59;

function subscribeCoarse(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(COARSE);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

/** Whether the main pointer is a finger (phones, tablets): their own time pickers are better there. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => typeof window.matchMedia === "function" && window.matchMedia(COARSE).matches,
    () => false,
  );
}

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * `time` moved by `by` minutes, kept within the day (00:00–23:59); from the suggestion when nothing valid
 * is typed. Null when there is neither (no default start time, spec §2b).
 */
export function shiftTime(time: string, by: number, suggested: string): string | null {
  const base = parseTime(time) || parseTime(suggested);
  if (!base) return null;
  return fromMinutes(Math.min(LAST_MINUTE, Math.max(0, toMinutes(base) + by)));
}

/**
 * The time of a stop being added (spec §1): the suggested time as the default chip, −30 / +30 minute
 * buttons, "No set time", and the time itself: the device's own time picker on touch screens, a typeable
 * HH:MM field elsewhere. Invalid input is the caller's to refuse (see `timeFrom`).
 */
export function TimePicker({
  id,
  inputRef,
  value,
  onChange,
  suggested,
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange(value: string): void;
  /** The suggested time ("HH:MM"), when there is one. */
  suggested?: string;
  invalid: boolean;
  describedBy: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations("trip");
  const coarse = useCoarsePointer();
  // −30/+30 move a time: with none typed and none suggested they are disabled.
  const shift = (by: number) => shiftTime(value, by, suggested ?? "");
  const canShift = shift(0) !== null;
  const step = "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-line bg-surface px-2 text-[13px] font-semibold tabular-nums hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-2 disabled:hover:bg-surface";
  const chip =
    "inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-[12.5px] font-medium hover:bg-hover aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white";
  return (
    <div>
      <label htmlFor={`${id}-time`} className="mb-1 block text-[13px] font-medium">
        {t("time")}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={step} disabled={!canShift} onClick={() => onChange(shift(-30) ?? value)}>
          {"−30 "}
          <span className="sr-only">{t("timeEarlier")}</span>
        </button>
        <input
          ref={inputRef}
          id={`${id}-time`}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-9 w-24 rounded-lg border border-ink-2 bg-surface px-2.5 text-[14px] font-semibold tabular-nums aria-[invalid=true]:border-danger"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...(coarse ? { type: "time" } : { type: "text", inputMode: "numeric" as const, placeholder: "HH:MM", maxLength: 5 })}
        />
        <button type="button" className={step} disabled={!canShift} onClick={() => onChange(shift(30) ?? value)}>
          {"+30 "}
          <span className="sr-only">{t("timeLater")}</span>
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {suggested && (
          <button type="button" className={chip} aria-pressed={value === suggested} onClick={() => onChange(suggested)}>
            {t("timeSuggested", { time: suggested })}
          </button>
        )}
        <button type="button" className={chip} aria-pressed={value.trim() === ""} onClick={() => onChange("")}>
          {t("noSetTime")}
        </button>
      </div>
    </div>
  );
}

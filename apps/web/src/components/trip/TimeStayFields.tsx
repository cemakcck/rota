"use client";

import type { ReactNode, RefObject } from "react";
import { useTranslations } from "next-intl";
import { errorText, hint } from "../ui";
import { parseTime } from "./plan";
import { StayChips } from "./StayChips";
import { TimePicker } from "./TimePicker";

/**
 * The time chosen in an add step: "HH:MM", "" for no set time, or null when it is not a time (typed
 * garbage, or a half-filled native time field, which reports an empty value).
 */
export function timeFrom(time: string, input: HTMLInputElement | null): string | null {
  if (input?.validity?.badInput) return null;
  return parseTime(time);
}

/** A stay chosen in an add step, in whole minutes (0–1440); `fallback` when it is empty or not a number. */
export function stayFrom(stay: string, fallback: number): number {
  const minutes = Number(stay);
  return stay.trim() !== "" && Number.isFinite(minutes) ? Math.min(1440, Math.max(0, Math.round(minutes))) : fallback;
}

/**
 * The time and stay of an add step (spec §1, §2b): the time (when it goes into a day) as a picker with
 * the suggestion as its default, which may be left without a time; the stay as chips. `before` comes
 * first in the row (a day choice), `after` after the time (the category).
 */
export function TimeStayFields({
  id,
  timeRef,
  withTime,
  time,
  onTime,
  suggested,
  invalid,
  stay,
  onStay,
  before,
  after,
  autoFocus = !before,
}: {
  id: string;
  timeRef: RefObject<HTMLInputElement | null>;
  withTime: boolean;
  time: string;
  onTime(value: string): void;
  /** The suggested time, offered as a chip. */
  suggested?: string;
  invalid: boolean;
  stay: string;
  onStay(value: string): void;
  before?: ReactNode;
  after?: ReactNode;
  /** Focus its first field when shown (by default, unless `before` comes first). */
  autoFocus?: boolean;
}) {
  const t = useTranslations("trip");
  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        {before}
        {withTime && (
          <TimePicker
            id={id}
            inputRef={timeRef}
            value={time}
            onChange={onTime}
            suggested={suggested || undefined}
            invalid={invalid}
            describedBy={invalid ? `${id}-error` : `${id}-hint`}
            autoFocus={autoFocus}
          />
        )}
        {after}
      </div>
      {withTime &&
        (invalid ? (
          <p id={`${id}-error`} role="alert" className={`${errorText} !mt-0`}>
            {t("timeInvalid")}
          </p>
        ) : (
          <p id={`${id}-hint`} className={`${hint} !mt-0`}>
            {t("timeHint")}
          </p>
        ))}
      <StayChips id={id} value={stay} onChange={onStay} autoFocus={autoFocus && !withTime} />
    </>
  );
}

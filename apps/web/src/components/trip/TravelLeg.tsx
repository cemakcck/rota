"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Leg, TravelMode } from "@rota/trip";
import { Icon } from "./icons";

/** "12 min" or "1 h 5 min". */
export function useDuration(): (seconds: number) => string {
  const t = useTranslations("trip");
  return (seconds) => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes < 60 ? t("minutesShort", { m: minutes }) : t("hoursShort", { h: Math.floor(minutes / 60), m: minutes % 60 });
  };
}

/** A stay: "45 min", "1 h", "1 h 15 min" ("0 min" for none). */
export function useStay(): (minutes: number) => string {
  const t = useTranslations("trip");
  return (minutes) => {
    if (minutes < 60) return t("minutesShort", { m: minutes });
    const [h, m] = [Math.floor(minutes / 60), minutes % 60];
    return m === 0 ? t("hoursOnly", { h }) : t("hoursShort", { h, m });
  };
}

/** "≈" for sighted readers, "estimated" for screen readers: a straight-line estimate, not a route. */
export function Approximate() {
  const t = useTranslations("trip");
  return (
    <>
      <span aria-hidden="true">≈</span> <span className="sr-only">{t("estimated")}, </span>
    </>
  );
}

/** The travel between two consecutive stops of a day: "12 min walk · 950 m", estimated ones marked "≈". */
export function TravelLeg({ leg, mode }: { leg: Leg; mode: TravelMode }) {
  const t = useTranslations("trip");
  const locale = useLocale();
  const duration = useDuration();
  const km = leg.meters >= 1000;
  const distance = new Intl.NumberFormat(locale, { style: "unit", unit: km ? "kilometer" : "meter", maximumFractionDigits: km ? 1 : 0 }).format(km ? leg.meters / 1000 : leg.meters);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon name={mode === "walk" ? "walk" : "car"} size={14} />
      <span className="min-w-0">
        {leg.approximate && <Approximate />}
        {`${t(mode === "walk" ? "legWalk" : "legDrive", { duration: duration(leg.seconds) })} · ${distance}`}
      </span>
    </span>
  );
}

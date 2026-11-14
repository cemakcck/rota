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
    <li data-testid="travel-leg" className="flex h-7 items-center gap-2 pl-[22px] font-mono text-[11.5px] text-ink-2">
      <span aria-hidden="true" className="h-full border-l-2 border-dotted border-line" />
      <Icon name={mode === "walk" ? "walk" : "car"} size={14} />
      {leg.approximate && <Approximate />}
      <span>{`${t(mode === "walk" ? "legWalk" : "legDrive", { duration: duration(leg.seconds) })} · ${distance}`}</span>
    </li>
  );
}

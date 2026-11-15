"use client";

import { useLocale, useTranslations } from "next-intl";
import type { HoursWarning as Warning } from "@rota/trip";
import { Icon } from "./icons";

/** An opening-hours warning for a stop (spec §8.2): a small amber line under the stop's sub-line. */
export function HoursWarning({ warning, date, arrive }: { warning: Warning; date: string; arrive: string | null }) {
  const t = useTranslations("trip");
  const locale = useLocale();
  const text =
    warning.kind === "closed-day"
      ? t("hoursClosedDay", { weekday: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) })
      : t(warning.kind === "opens-later" ? "hoursOpensLater" : "hoursClosesBefore", { at: warning.at ?? "", arrive: arrive ?? "" });
  return (
    <p role="note" className="mt-0.5 flex min-w-0 items-start gap-1 text-[12px] font-medium leading-snug text-warn-ink">
      <Icon name="warn" size={13} className="mt-px" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

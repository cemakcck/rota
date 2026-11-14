"use client";

import { useLocale, useTranslations } from "next-intl";
import type { HoursWarning as Warning } from "@rota/trip";
import { Icon } from "./icons";

/** An opening-hours warning for a stop (spec §8.2), in the warm warning tone. */
export function HoursWarning({ warning, date, arrive }: { warning: Warning; date: string; arrive: string }) {
  const t = useTranslations("trip");
  const locale = useLocale();
  const text =
    warning.kind === "closed-day"
      ? t("hoursClosedDay", { weekday: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) })
      : t(warning.kind === "opens-later" ? "hoursOpensLater" : "hoursClosesBefore", { at: warning.at ?? "", arrive });
  return (
    <p role="note" className="flex items-start gap-2 rounded-[9px] bg-warn-bg px-2.5 py-2 text-[12.5px] leading-snug text-warn-ink shadow-[inset_0_0_0_1px_var(--color-warn-line)]">
      <Icon name="warn" size={14} className="mt-px" />
      {text}
    </p>
  );
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import type { DayWeather } from "@/client/useWeather";
import { Icon, type IconName } from "./icons";

type Condition = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "showers" | "snow" | "storm";

/** WMO weather codes, as Open-Meteo reports them, grouped into what the chip shows. */
function conditionOf(code: number): Condition {
  if (code === 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 95) return "storm";
  return "cloudy";
}

const ICONS: Record<Condition, IconName> = {
  clear: "sun",
  partly: "partly",
  cloudy: "cloud",
  fog: "fog",
  drizzle: "rain",
  rain: "rain",
  showers: "rain",
  snow: "snow",
  storm: "storm",
};

const chip = "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface pl-2 pr-2.5 text-[12.5px] text-ink-2";
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/**
 * A day's weather (spec §8.4): icon, high and low, read out with the condition and the chance of rain;
 * or the date its forecast appears. `day` names the day, for the header's strip.
 */
export function WeatherChip({ weather, day }: { weather: DayWeather; day?: string }) {
  const t = useTranslations("weather");
  const locale = useLocale();
  if ("from" in weather) {
    const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(utc(weather.from));
    return <span className={chip}>{t("forecastFrom", { date })}</span>;
  }
  const { code, max, min, rain } = weather.forecast;
  const condition = conditionOf(code);
  const summary = rain === null ? t("summary", { condition: t(`conditions.${condition}`), max, min }) : t("summaryRain", { condition: t(`conditions.${condition}`), max, min, rain });
  const weekday = day && new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(utc(day));
  return (
    <span role="img" aria-label={weekday ? t("onDay", { day: weekday, summary }) : summary} className={chip}>
      <Icon name={ICONS[condition]} />
      {weekday}
      <b className="font-mono text-[12px] font-semibold text-ink">{max}°</b>
      <span className="font-mono text-[12px]">{min}°</span>
    </span>
  );
}

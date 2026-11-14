import { addDaysToDate, type TripView } from "@rota/trip";
import { tripCentre } from "@/components/trip/plan";
import { apiFetch } from "./authClient";
import { createRemote, getJson, useRemote } from "./remote";

export type DayForecast = { date: string; code: number; max: number; min: number; rain: number | null };
/** What to show for a day: its forecast, or the date its forecast becomes available. */
export type DayWeather = { forecast: DayForecast } | { from: string };
type Forecast = { days: DayForecast[]; availableFrom: string | null };

/** How many days ahead a date's forecast appears (Open-Meteo covers today and 15 more). */
const LEAD_DAYS = 15;

const forecasts = createRemote<Forecast>(async ([key]) => {
  const [lat, lng, start, end] = key.split(",");
  return new Map([[key, await getJson<Forecast>(`/api/weather?lat=${lat}&lng=${lng}&start=${start}&end=${end}`, apiFetch)]]);
});

/**
 * The weather per trip date (spec §8.4) at the destination, else the centre of the places: the
 * forecast once it covers the date, else when it will. Dates in the past, or before any answer, have none.
 */
export function useWeather(view: TripView): Record<string, DayWeather> {
  const centre = tripCentre(view);
  const dates = view.days.map((d) => d.date).filter(Boolean);
  const key = centre && dates.length > 0 ? `${centre.lat.toFixed(2)},${centre.lng.toFixed(2)},${dates[0]},${dates.at(-1)}` : null;
  const { get } = useRemote(forecasts, key ? [key] : []);
  const answer = key ? get(key) : undefined;
  const out: Record<string, DayWeather> = {};
  if (!answer) return out;
  for (const forecast of answer.days) out[forecast.date] = { forecast };
  if (answer.availableFrom) {
    for (const date of dates) {
      const from = addDaysToDate(date, -LEAD_DAYS);
      if (!out[date] && date >= answer.availableFrom) out[date] = { from: from > answer.availableFrom ? from : answer.availableFrom };
    }
  }
  return out;
}

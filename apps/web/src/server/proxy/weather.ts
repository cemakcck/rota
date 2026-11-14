import { addDaysToDate } from "@rota/trip";
import { createCache } from "./cache";
import { throttled } from "./upstream";

export type DayForecast = { date: string; code: number; max: number; min: number; rain: number | null };
export type Forecast = { days: DayForecast[]; availableFrom: string | null };
type OpenMeteoResponse = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
  };
};

/** Open-Meteo forecasts today and the next 15 days. */
const FORECAST_DAYS = 16;
const openMeteo = throttled("open-meteo");
const forecasts = createCache<DayForecast[]>(1000, 3 * 3600 * 1000);

/**
 * The daily forecast for the dates from `start` to `end` that it covers yet. `availableFrom` is when the
 * first date it does not cover yet comes into range (null when all are covered or already past).
 */
export async function forecast(lat: number, lng: number, start: string, end: string, today: string = new Date().toISOString().slice(0, 10)): Promise<Forecast> {
  const last = addDaysToDate(today, FORECAST_DAYS - 1);
  const from = start > today ? start : today;
  const to = end < last ? end : last;
  const availableFrom = end > last ? addDaysToDate(start > last ? start : addDaysToDate(last, 1), -(FORECAST_DAYS - 1)) : null;
  if (from > to) return { days: [], availableFrom };

  const [la, ln] = [Math.round(lat * 100) / 100, Math.round(lng * 100) / 100];
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${ln}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${from}&end_date=${to}`;
  let days = forecasts.get(url);
  if (!days) {
    const daily = (await openMeteo<OpenMeteoResponse>(url)).daily ?? {};
    days = (daily.time ?? []).flatMap((date, i) => {
      const [code, max, min] = [daily.weather_code?.[i], daily.temperature_2m_max?.[i], daily.temperature_2m_min?.[i]];
      if (typeof code !== "number" || typeof max !== "number" || typeof min !== "number") return [];
      const rain = daily.precipitation_probability_max?.[i];
      return [{ date, code, max: Math.round(max), min: Math.round(min), rain: typeof rain === "number" ? rain : null }];
    });
    forecasts.set(url, days);
  }
  return { days, availableFrom };
}

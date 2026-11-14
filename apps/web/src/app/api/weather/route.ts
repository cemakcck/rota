import { z } from "zod";
import { addDaysToDate } from "@rota/trip";
import { route } from "@/server/http";
import { forecast } from "@/server/proxy/weather";
import { limitPerMinute, orUnavailable, queryOf } from "@/server/proxy/upstream";
import { dateString } from "../trips/route";

const query = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    start: dateString,
    end: dateString,
  })
  // At most a trip's length (30 days).
  .refine((v) => v.start <= v.end && v.end <= addDaysToDate(v.start, 29));

/** The daily forecast at a point for a trip's dates (Open-Meteo). */
export const GET = route(async ({ req }) => {
  const { lat, lng, start, end } = query.parse(queryOf(req));
  await limitPerMinute(req, "weather", 60);
  return orUnavailable(() => forecast(lat, lng, start, end));
});

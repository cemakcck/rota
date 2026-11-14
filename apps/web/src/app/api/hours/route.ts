import { z } from "zod";
import { route } from "@/server/http";
import { openingHours } from "@/server/proxy/hours";
import { limitPerMinute, orUnavailable, queryOf } from "@/server/proxy/upstream";

const query = z.object({
  ids: z
    .string()
    .transform((s) => [...new Set(s.split(","))])
    .pipe(z.array(z.string().regex(/^[nwr][1-9]\d{0,15}$/)).min(1).max(25)),
});

/** OpenStreetMap opening hours (Overpass) for up to 25 places at once. */
export const GET = route(async ({ req }) => {
  const { ids } = query.parse(queryOf(req));
  await limitPerMinute(req, "hours", 60);
  return { hours: await orUnavailable(() => openingHours(ids)) };
});

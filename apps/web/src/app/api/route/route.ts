import { z } from "zod";
import { route } from "@/server/http";
import { routeBetween } from "@/server/proxy/route";
import { limitPerMinute, orUnavailable, queryOf } from "@/server/proxy/upstream";

const point = z
  .string()
  .transform((s) => s.split(",").map(Number))
  .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]));
const query = z.object({
  mode: z.enum(["walk", "drive"]),
  coords: z
    .string()
    .transform((s) => s.split(";"))
    .pipe(z.array(point).min(2).max(25)),
});

/** Travel times and the road geometry between consecutive stops (FOSSGIS OSRM). */
export const GET = route(async ({ req }) => {
  const { mode, coords } = query.parse(queryOf(req));
  await limitPerMinute(req, "route", 120);
  return orUnavailable(() => routeBetween(mode, coords));
});

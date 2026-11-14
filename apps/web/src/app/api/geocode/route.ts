import { z } from "zod";
import { route } from "@/server/http";
import { search } from "@/server/proxy/geocode";
import { limitPerMinute, orUnavailable, queryOf } from "@/server/proxy/upstream";

const query = z
  .object({
    q: z.string().trim().min(2).max(100),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    lang: z.enum(["en", "tr"]).default("en"),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined));

/** Place search (Photon), biased towards a point when one is given. */
export const GET = route(async ({ req }) => {
  const { q, lat, lng, lang } = query.parse(queryOf(req));
  await limitPerMinute(req, "geocode", 60);
  const near = lat !== undefined && lng !== undefined ? { lat, lng } : null;
  return { results: await orUnavailable(() => search(q, near, lang)) };
});

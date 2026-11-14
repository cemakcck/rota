import { z } from "zod";
import { route } from "@/server/http";
import { reverseName } from "@/server/proxy/geocode";
import { limitPerMinute, orUnavailable, queryOf } from "@/server/proxy/upstream";

const query = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

/** The name of the place at a point (Photon reverse geocoding). Shares search's limit. */
export const GET = route(async ({ req }) => {
  const { lat, lng } = query.parse(queryOf(req));
  await limitPerMinute(req, "geocode", 60);
  return { name: await orUnavailable(() => reverseName(lat, lng)) };
});

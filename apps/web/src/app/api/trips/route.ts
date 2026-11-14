import { z } from "zod";
import { createTrip, listTrips } from "@/server/trips/repo";
import { parseBody, route } from "@/server/http";

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "not a real date");

const body = z.object({
  name: z.string().trim().min(1).max(60),
  startDate: dateString,
  days: z.number().int().min(1).max(30),
  destination: z.object({ name: z.string().min(1).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullish(),
  locale: z.enum(["en", "tr"]),
});

export const GET = route(async ({ user }) => listTrips(user.id));

export const POST = route(async ({ req, user }) => {
  const input = await parseBody(req, body);
  const id = await createTrip({ ownerId: user.id, ...input, destination: input.destination ?? null, isDemo: false });
  return { status: 201, body: { id } };
});

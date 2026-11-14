import { ZodError, type ZodType } from "zod";
import { getSessionFromRequest } from "./auth";
import { HttpError } from "./httpError";
import { touchUser } from "./trips/repo";

export type SessionUser = { id: string; name: string; email: string };
type Params = Record<string, string>;

/** Reads and validates a JSON body; a bad body is a 400. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid_body");
  return parsed.data;
}

/**
 * Wraps a route handler: requires a session (401), turns HttpError into `{ error }` JSON, and
 * keeps unexpected failures from leaking details. Returning nothing is a 204.
 */
export function route(
  fn: (ctx: { req: Request; user: SessionUser; params: Params }) => Promise<Response | { status: number; body?: unknown } | unknown>,
) {
  return async (req: Request, { params }: { params: Promise<Params> }): Promise<Response> => {
    try {
      const session = await getSessionFromRequest(req);
      if (!session) throw new HttpError(401, "unauthorized");
      await touchUser(session.user.id);
      const out = await fn({ req, user: session.user, params: await params });
      if (out instanceof Response) return out;
      if (out === undefined) return new Response(null, { status: 204 });
      if (typeof out === "object" && out !== null && "status" in out) {
        const { status, body } = out as { status: number; body?: unknown };
        return Response.json(body ?? null, { status });
      }
      return Response.json(out);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof ZodError) return Response.json({ error: "invalid_body" }, { status: 400 });
      console.error("[api] unexpected error", err);
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  };
}

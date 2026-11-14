import { z } from "zod";
import { HttpError } from "@/server/httpError";
import { clientIp } from "@/server/ipHash";
import { parseBody } from "@/server/http";
import { startDemo } from "@/server/demo";

const body = z.object({ locale: z.enum(["en", "tr"]) });

/** "Try the demo": no session needed. Sets the visitor's session cookie and returns their trip. */
export async function POST(req: Request): Promise<Response> {
  try {
    const { locale } = await parseBody(req, body);
    const { sessionCookie, tripId } = await startDemo({ ip: clientIp(req), locale });
    const res = Response.json({ tripId }, { status: 201 });
    res.headers.append("set-cookie", sessionCookie);
    return res;
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[api] demo start failed", err);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

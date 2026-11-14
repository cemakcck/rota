// Liveness only: deliberately touches no database.
export function GET() {
  return Response.json({ ok: true });
}

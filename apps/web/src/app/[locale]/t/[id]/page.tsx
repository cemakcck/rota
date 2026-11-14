import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { isTripId } from "@rota/trip";
import { TripScreen } from "@/components/trip/TripScreen";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/server/auth";
import { HttpError } from "@/server/httpError";
import { requireMember } from "@/server/trips/access";

/**
 * The trip screen. Members only: a signed-in non-member gets the same 404 as a trip that does not exist,
 * and a signed-out visitor goes to sign in and comes back.
 *
 * A friend window (`?friend=1`, spec §11) is a second person in the same browser: its session is a bearer
 * token in that window's sessionStorage, which the server cannot see (the cookie is the visitor's). Its
 * page is served without the check; the page holds no trip data, and the sync server checks the friend's
 * token, so a refusal shows as the client's closed notice ("not available to you").
 */
export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!isTripId(id)) notFound();
  if ((await searchParams).friend !== "1") await requireMemberPage(id, locale);
  return <TripScreen tripId={id} />;
}

async function requireMemberPage(tripId: string, locale: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return redirect({ href: `/sign-in?next=${encodeURIComponent(`/t/${tripId}`)}`, locale });
  try {
    await requireMember(session.user.id, tripId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    // The database is unreachable: the page carries no trip data and sync checks membership itself,
    // so the screen opens from this device's copy instead of failing.
    console.error("[trip page] membership check failed", e);
  }
}

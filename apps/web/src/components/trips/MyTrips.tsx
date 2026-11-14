"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch, useUserState } from "@/client/authClient";
import { cacheTrips, cachedTrips, hasOfflineCopy, type CachedTrip } from "@/client/myTrips";
import { Link, useRouter } from "@/i18n/navigation";
import { Avatar } from "../Avatar";
import { btnPrimary, card, errorText } from "../ui";
import { formatRange, splitTrips } from "./dates";

type State = { trips: CachedTrip[]; offline: boolean } | "loading" | "failed";

export function MyTrips() {
  const t = useTranslations("trips");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { userId, signedOut } = useUserState();
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (signedOut) router.replace("/sign-in?next=%2Ftrips");
  }, [signedOut, router]);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    (async () => {
      try {
        const res = await apiFetch("/api/trips");
        if (res.status === 401) return router.replace("/sign-in?next=%2Ftrips");
        if (!res.ok) throw new Error(String(res.status));
        const trips = (await res.json()) as CachedTrip[];
        cacheTrips(userId, trips);
        if (live) setState({ trips, offline: false });
      } catch {
        // No network (or the server is down): the list from the last visit, if there is one.
        const trips = cachedTrips(userId);
        if (live) setState(trips.length > 0 ? { trips, offline: true } : "failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [userId, router]);

  if (state === "loading") return <p role="status">{tc("loading")}</p>;
  if (state === "failed")
    return (
      <p role="alert" className={errorText}>
        {t("loadFailed")}
      </p>
    );

  const { upcoming, past } = splitTrips(state.trips, new Date().toISOString().slice(0, 10));
  const section = (id: string, title: string, list: CachedTrip[]) =>
    list.length > 0 && (
      <section aria-labelledby={`trips-${id}`} className="mt-8">
        <h2 id={`trips-${id}`} className="mb-3 text-[15px] font-semibold">
          {title}
        </h2>
        <ul className="grid gap-3">
          {list.map((trip) => (
            <li key={trip.id}>
              <TripCard trip={trip} locale={locale} offlineCopy={userId !== null && hasOfflineCopy(trip.id, userId)} />
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div>
      {state.offline && (
        <p role="status" className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 font-medium text-warn-ink">
          {t("offlineNotice")}
        </p>
      )}
      {state.trips.length === 0 && <p className="mt-6 text-ink-2">{t("empty")}</p>}
      {section("upcoming", t("upcoming"), upcoming)}
      {section("past", t("past"), past)}
    </div>
  );
}

function TripCard({ trip, locale, offlineCopy }: { trip: CachedTrip; locale: string; offlineCopy: boolean }) {
  const t = useTranslations("trips");
  return (
    <div className={`${card} flex items-center justify-between gap-4 !p-4`}>
      <div className="min-w-0">
        <Link href={`/t/${trip.id}`} className="text-[15px] font-semibold hover:underline">
          {trip.name}
          <span className="sr-only">
            , {formatRange(locale, trip.startDate, trip.days)}
          </span>
        </Link>
        <p className="mt-0.5 text-ink-2" aria-hidden="true">
          {formatRange(locale, trip.startDate, trip.days)} · {t("days", { count: trip.days })}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {offlineCopy && <span className="inline-flex h-5 items-center rounded-md bg-line-2 px-2 text-[11.5px] font-medium text-ink-2">{t("offlineBadge")}</span>}
          {trip.isDemo && <span className="inline-flex h-5 items-center rounded-md bg-line-2 px-2 text-[11.5px] font-medium text-ink-2">{t("demo")}</span>}
        </div>
      </div>
      <div className="flex shrink-0 -space-x-1.5">
        {trip.members.slice(0, 5).map((m) => (
          <Avatar key={m.id} name={m.name} colour={m.colour} />
        ))}
      </div>
    </div>
  );
}

export function NewTripLink() {
  const t = useTranslations("trips");
  return (
    <Link href="/trips/new" className={btnPrimary}>
      {t("new")}
    </Link>
  );
}

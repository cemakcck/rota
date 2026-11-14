"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch, useUserState } from "@/client/authClient";
import { useRouter } from "@/i18n/navigation";
import { errorText } from "../ui";
import type { TripMember } from "./MembersPanel";
import { TripSettings, type TripMeta } from "./TripSettings";

type Loaded = TripMeta & { members: TripMember[] };

/** Loads a trip and shows its settings: the trip screen's settings sheet. */
export function TripSettingsScreen({ tripId }: { tripId: string }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { userId, signedOut } = useUserState();
  const router = useRouter();
  const [trip, setTrip] = useState<Loaded | "loading" | "failed">("loading");
  const signIn = `/sign-in?next=${encodeURIComponent(`/t/${tripId}`)}`;

  useEffect(() => {
    if (signedOut) router.replace(signIn);
  }, [signedOut, router, signIn]);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/trips/${tripId}`);
        if (res.status === 401) return router.replace(signIn);
        const next = res.ok ? ((await res.json()) as Loaded) : "failed";
        if (live) setTrip(next);
      } catch {
        if (live) setTrip("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [tripId, version, router, signIn]);

  if (trip === "loading" || !userId) return <p role="status">{tc("loading")}</p>;
  if (trip === "failed")
    return (
      <p role="alert" className={errorText}>
        {t("loadFailed")}
      </p>
    );
  // `key` restarts the form when the trip changes underneath it (renamed elsewhere, days changed).
  return <TripSettings key={`${trip.name}|${trip.startDate}|${trip.days}`} trip={trip} members={trip.members} userId={userId} locale={locale} onChanged={() => setVersion((v) => v + 1)} />;
}

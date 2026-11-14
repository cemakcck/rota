"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ClosedReason } from "@/client/sync/useTrip";
import { Link } from "@/i18n/navigation";
import { btn, btnPrimary, card } from "../ui";

/**
 * Why the server stopped syncing this trip (removed, deleted, no access, signed out). The copy on this
 * device stays until the person removes it here; anything edited after the refusal is not saved, and
 * says so instead of vanishing silently.
 */
export function ClosedNotice({ reason, tripId, onRemove }: { reason: ClosedReason; tripId: string; onRemove: () => Promise<void> }) {
  const t = useTranslations("trip");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-md content-center px-4 py-10">
      <div role="alert" className={`${card} grid gap-3`}>
        <p className="text-[16px] font-semibold">{t(`closed.${reason}`)}</p>
        <p className="text-ink-2">{t("closedDiscarded")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onRemove();
            }}
          >
            {t("removeCopy")}
          </button>
          {reason === "unauthorized" ? (
            <Link href={`/sign-in?next=${encodeURIComponent(`/t/${tripId}`)}`} className={btn}>
              {t("signIn")}
            </Link>
          ) : (
            <Link href="/trips" className={btn}>
              {tc("backToTrips")}
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

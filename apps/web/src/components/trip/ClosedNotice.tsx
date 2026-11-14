"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ClosedReason } from "@/client/sync/useTrip";
import { Link } from "@/i18n/navigation";
import { btn, btnPrimary, card } from "../ui";

/**
 * Why the server stopped syncing this trip (removed, deleted, no access, signed out). Signed out is
 * the one that passes: the copy on this device and its pending edits sync again after signing in, so
 * it only asks for that. Otherwise the copy stays until the person removes it here; anything edited
 * after the refusal is not saved, and says so instead of vanishing silently.
 */
export function ClosedNotice({
  reason,
  tripId,
  pending,
  onRemove,
}: {
  reason: ClosedReason;
  tripId: string;
  /** Edits on this device the server has not confirmed yet. */
  pending: number;
  onRemove: () => Promise<void>;
}) {
  const t = useTranslations("trip");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);

  if (reason === "unauthorized")
    return (
      <main id="main" className="mx-auto grid min-h-dvh max-w-md content-center px-4 py-10">
        <div role="alert" className={`${card} grid gap-3`}>
          <p className="text-[16px] font-semibold">{t("closed.unauthorized")}</p>
          <p className="text-ink-2">{t("closedSignInToSync", { count: pending })}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={`/sign-in?next=${encodeURIComponent(`/t/${tripId}`)}`} className={btnPrimary}>
              {t("signIn")}
            </Link>
          </div>
        </div>
      </main>
    );

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
          <Link href="/trips" className={btn}>
            {tc("backToTrips")}
          </Link>
        </div>
      </div>
    </main>
  );
}

"use client";

import { useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { friendSession, isFriendWindow } from "@/client/authClient";
import { btn, btnSm } from "../ui";
import { FriendButton, fetchFriendWindow, type FriendWindow } from "./FriendButton";

const WIDE = "(min-width: 1280px)";
const never = () => () => undefined;

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia?.(WIDE);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** Screens of 1280 px or more, where the friend's window fits beside the trip. */
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia?.(WIDE).matches ?? false, () => false);
}

type Props = {
  tripId: string;
  simulateOffline(on: boolean): void;
  onSideBySide(friend: FriendWindow): void;
};

/**
 * The demo trip's banner (spec §11): what the demo is, "Simulate offline" and "Try it with a friend"
 * (and "Side by side" on wide screens). A friend window shows who you are there instead.
 */
export function DemoBanner({ tripId, simulateOffline, onSideBySide }: Props) {
  const t = useTranslations("demo");
  const locale = useLocale();
  // Window state, read after hydration (the server renders the visitor's view).
  const friendName = useSyncExternalStore(never, () => (isFriendWindow() ? (friendSession()?.user.name ?? "") : null), () => null);
  const wide = useWide();
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState(false);

  if (friendName !== null)
    return friendName ? <p className="border-b border-line bg-surface px-4 py-2 text-[13px] font-medium">{t("friendWindow", { name: friendName })}</p> : null;

  const toggleOffline = () => {
    simulateOffline(!offline);
    setOffline(!offline);
  };
  const sideBySide = async () => {
    setFailed(false);
    try {
      onSideBySide(await fetchFriendWindow(locale, tripId));
    } catch {
      setFailed(true);
    }
  };

  return (
    <section aria-label={t("label")} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warn-line bg-warn-bg px-4 py-2 text-[13px] text-warn-ink">
      <p className="min-w-0 flex-1 basis-64">{t("notice")}</p>
      <button type="button" role="switch" aria-checked={offline} onClick={toggleOffline} className="inline-flex h-8 items-center gap-2 rounded-lg px-1.5 font-medium text-ink hover:bg-hover">
        <span aria-hidden="true" className={`relative h-5 w-9 rounded-full border ${offline ? "border-ink bg-ink" : "border-ink-2 bg-surface"}`}>
          <span className={`absolute top-0.5 size-3.5 rounded-full motion-safe:transition-[left] ${offline ? "left-[18px] bg-white" : "left-0.5 bg-ink-2"}`} />
        </span>
        {t("simulateOffline")}
      </button>
      <FriendButton tripId={tripId} onFailed={setFailed} />
      {wide && (
        <button type="button" className={`${btn} ${btnSm}`} onClick={sideBySide}>
          {t("sideBySide")}
        </button>
      )}
      {failed && (
        <p role="alert" className="basis-full font-medium text-danger">
          {t("friendFailed")}
        </p>
      )}
    </section>
  );
}

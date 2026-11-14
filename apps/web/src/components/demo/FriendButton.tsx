"use client";

import { useLocale, useTranslations } from "next-intl";
import { apiFetch, type FriendSession } from "@/client/authClient";
import { friendUrl } from "@/client/friendHandoff";
import { btn, btnSm } from "../ui";

export type FriendWindow = { url: string; name: string };

/** A fresh session for the demo trip's friend Deniz, as the address of a friend window (spec §11). */
export async function fetchFriendWindow(locale: string, tripId: string): Promise<FriendWindow> {
  const res = await apiFetch("/api/demo/friend-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId }),
  });
  if (!res.ok) throw new Error(`friend token refused: ${res.status}`);
  const session = (await res.json()) as FriendSession;
  return { url: friendUrl(locale, tripId, session), name: session.user.name };
}

/**
 * "Try it with a friend": the trip in a second window, signed in as Deniz, at half the screen's width.
 * The window opens during the click (so it is not blocked as a pop-up) and is sent to the friend's
 * address once the token arrives; it is closed again if the token does not come.
 * `onFailed` hears whether this attempt failed.
 */
export function FriendButton({ tripId, onFailed }: { tripId: string; onFailed(failed: boolean): void }) {
  const t = useTranslations("demo");
  const locale = useLocale();

  async function open() {
    const width = Math.round(window.screen.availWidth / 2);
    const child = window.open("about:blank", "_blank", `popup,width=${width},height=${window.screen.availHeight},left=${window.screen.availWidth - width},top=0`);
    if (!child) return onFailed(true);
    onFailed(false);
    try {
      const { url } = await fetchFriendWindow(locale, tripId);
      // The friend's window has no hold on this one.
      child.opener = null;
      child.location.href = new URL(url, window.location.origin).href;
    } catch {
      child.close();
      onFailed(true);
    }
  }

  return (
    <button type="button" className={`${btn} ${btnSm}`} onClick={open}>
      {t("tryFriend")}
    </button>
  );
}

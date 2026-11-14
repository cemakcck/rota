"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { btn, btnSm } from "../ui";
import type { FriendWindow } from "./FriendButton";

/**
 * The page split in two on wide screens: the visitor's trip on the left, the friend's window (the same
 * trip, signed in as Deniz) in a frame on the right. With no `friend` the children render as they are;
 * the tree stays the same either way, so opening or closing the split never remounts the trip.
 */
export function SideBySide({ friend, onClose, children }: { friend: FriendWindow | null; onClose(): void; children: ReactNode }) {
  const t = useTranslations("demo");
  const title = friend ? t("friendFrame", { name: friend.name }) : "";
  return (
    <div className={friend ? "grid h-dvh grid-cols-2" : "contents"}>
      <div className={friend ? "min-w-0 overflow-hidden" : "contents"}>{children}</div>
      {friend && (
        <section aria-label={title} className="flex min-w-0 flex-col border-l border-line bg-paper">
          <div className="flex justify-end border-b border-line px-3 py-1.5">
            <button type="button" className={`${btn} ${btnSm}`} onClick={onClose}>
              {t("closeSideBySide")}
            </button>
          </div>
          <iframe title={title} src={friend.url} className="min-h-0 w-full flex-1" />
        </section>
      )}
    </div>
  );
}

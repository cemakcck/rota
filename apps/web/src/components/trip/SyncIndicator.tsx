"use client";

import { useTranslations } from "next-intl";
import type { SyncStatus } from "@/client/sync/status";
import { Icon } from "./icons";

/**
 * "Synced" / "Syncing…" / "Offline — N changes waiting" (spec §10). Not a live region: it changes with
 * every edit, and announcing that would drown out everything else.
 */
export function SyncIndicator({ status }: { status: SyncStatus }) {
  const t = useTranslations("trip");
  const look = {
    synced: "text-ink-2",
    syncing: "bg-hover text-ink-2",
    offline: "bg-warn-bg text-warn-ink shadow-[inset_0_0_0_1px_var(--color-warn-line)]",
  }[status.kind];
  return (
    <span className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-medium ${look}`}>
      {status.kind === "synced" && <Icon name="check" size={14} />}
      {status.kind === "syncing" && <span aria-hidden="true" className="size-3 rounded-full border-[1.75px] border-current border-r-transparent opacity-80 motion-safe:animate-spin" />}
      {status.kind === "offline" && <Icon name="cloudOff" size={14} />}
      {status.kind === "offline" ? t("offline", { count: status.pending }) : t(status.kind)}
    </span>
  );
}

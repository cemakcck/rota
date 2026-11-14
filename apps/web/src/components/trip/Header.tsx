"use client";

import { useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useLocale, useTranslations } from "next-intl";
import { addDaysToDate, type TripView } from "@rota/trip";
import type { SyncStatus } from "@/client/sync/status";
import { Link } from "@/i18n/navigation";
import { errorText } from "../ui";
import { Icon } from "./icons";
import { SyncIndicator } from "./SyncIndicator";

const iconButton = "grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40";

/** "Fri, Nov 27 – Sun, Nov 29" for the trip's calendar days (formatted in UTC: they are dates, not instants). */
function dateRange(locale: string, startDate: string, days: number): string {
  const day = (date: string) => new Date(`${date}T00:00:00Z`);
  const end = addDaysToDate(startDate, Math.max(days - 1, 0));
  if (!end) return "";
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).formatRange(day(startDate), day(end));
}

/** The trip's name, renamed in place (Enter or leaving the field saves, Escape cancels). */
function TripName({ name, onRename }: { name: string; onRename: ((name: string) => void) | null }) {
  const t = useTranslations("trip");
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  const close = () => {
    setDraft(null);
    setInvalid(false);
    requestAnimationFrame(() => button.current?.focus());
  };
  const commit = () => {
    if (draft === null || !onRename) return;
    const next = draft.trim();
    if (next.length < 1 || next.length > 60) return setInvalid(true);
    if (next !== name) onRename(next);
    close();
  };

  if (draft !== null)
    return (
      <div className="min-w-0">
        <label htmlFor="trip-name" className="sr-only">
          {t("tripName")}
        </label>
        <input
          id="trip-name"
          autoFocus
          value={draft}
          maxLength={60}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "trip-name-error" : undefined}
          className="h-8 w-full min-w-0 rounded-md border border-ink-2 bg-surface px-2 text-[16px] font-semibold"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") close();
          }}
        />
        {invalid && (
          <p id="trip-name-error" className={errorText}>
            {t("nameInvalid")}
          </p>
        )}
      </div>
    );
  return (
    <div className="flex min-w-0 items-center gap-1">
      <h1 className="min-w-0 text-[16px] font-semibold tracking-[-0.015em] [overflow-wrap:anywhere]">{name}</h1>
      {onRename && (
        <button ref={button} type="button" className={iconButton} aria-label={t("rename")} onClick={() => setDraft(name)}>
          <Icon name="pencil" size={14} />
        </button>
      )}
    </div>
  );
}

export type UndoControls = { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void };

/**
 * The trip screen's header: home, the trip's name and dates, sync status, who is here now, undo/redo
 * and the settings menu (members, invites, trip details), which opens as a side sheet.
 */
export function Header({
  view,
  status,
  history,
  onRename,
  settings,
  presence,
}: {
  view: TripView;
  status: SyncStatus;
  history: UndoControls | null;
  onRename: ((name: string) => void) | null;
  settings: ReactNode;
  /** Avatars of who is here now. */
  presence: ReactNode;
}) {
  const t = useTranslations("trip");
  const locale = useLocale();
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
      <Link href="/trips" aria-label={t("home")} className="flex h-8 items-center gap-2 border-r border-line pr-3.5 text-[15px] font-bold tracking-[-0.02em]">
        <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#1c1b19" />
          <path d="M7.5 15.5c2-5 7-2 9-7" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="7.5" cy="15.5" r="1.8" fill="#fff" />
          <circle cx="16.5" cy="8.5" r="1.8" fill="#fff" />
        </svg>
        <span className="hidden sm:inline">rota</span>
      </Link>
      <div className="grid min-w-0 flex-1 gap-px">
        <TripName name={view.name} onRename={onRename} />
        <p className="text-[12.5px] text-ink-2">{t("dates", { range: dateRange(locale, view.startDate, view.days.length), count: view.days.length })}</p>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <SyncIndicator status={status} />
        {presence}
        {history && (
          <>
            <button type="button" className={iconButton} aria-label={t("undo")} aria-keyshortcuts="Control+Z Meta+Z" disabled={!history.canUndo} onClick={history.undo}>
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className={iconButton}
              aria-label={t("redo")}
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
              disabled={!history.canRedo}
              onClick={history.redo}
            >
              <Icon name="redo" />
            </button>
          </>
        )}
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button type="button" className={iconButton} aria-label={t("settings")}>
              <Icon name="settings" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-line bg-paper p-5 shadow-3 sm:p-6"
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <Dialog.Title className="text-[20px] font-semibold tracking-tight">{t("settings")}</Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" className={iconButton} aria-label={t("close")}>
                    <Icon name="close" />
                  </button>
                </Dialog.Close>
              </div>
              {settings}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </header>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useLocale, useTranslations } from "next-intl";
import { addDaysToDate, type MemberView, type TripView } from "@rota/trip";
import { apiFetch } from "@/client/authClient";
import type { Peer } from "@/client/presence";
import type { SyncStatus } from "@/client/sync/status";
import type { DayWeather } from "@/client/useWeather";
import { Link } from "@/i18n/navigation";
import { errorText, hint } from "../ui";
import { Icon } from "./icons";
import { InvitePanel } from "./InvitePanel";
import { MembersPanel, type TripMember } from "./MembersPanel";
import { Presence } from "./Presence";
import { SyncIndicator } from "./SyncIndicator";
import { WeatherChip } from "./WeatherChip";

const iconButton = "grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40";

/** "Fri, Nov 27 – Sun, Nov 29" for the trip's calendar days (formatted in UTC: they are dates, not instants). */
function dateRange(locale: string, startDate: string, days: number): string {
  const day = (date: string) => new Date(`${date}T00:00:00Z`);
  const end = addDaysToDate(startDate, Math.max(days - 1, 0));
  if (!end) return "";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).formatRange(day(startDate), day(end));
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
          className="h-8 w-full min-w-0 rounded-md border border-ink-2 bg-surface px-2 font-serif text-[18px] font-semibold"
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
      <h1 className="min-w-0 truncate font-serif text-[19px] font-semibold leading-tight" title={name}>
        {name}
      </h1>
      {onRename && (
        <button ref={button} type="button" className={`${iconButton} shrink-0`} aria-label={t("rename")} onClick={() => setDraft(name)}>
          <Icon name="pencil" size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * The header's weather strip: each day with a forecast, or when the first forecast appears. Hidden on
 * small screens, where each day's own chip shows it.
 */
function WeatherStrip({ view, weather }: { view: TripView; weather: Record<string, DayWeather> }) {
  const tw = useTranslations("weather");
  const days = view.days.filter((d) => weather[d.date] && "forecast" in weather[d.date]);
  const next = view.days.map((d) => weather[d.date]).find((w) => w && "from" in w);
  if (days.length === 0 && !next) return null;
  return (
    <div role="group" aria-label={tw("label")} className="hidden gap-1.5 lg:flex">
      {days.length > 0 ? days.map((d) => <WeatherChip key={d.id} weather={weather[d.date]} day={d.date} />) : next && <WeatherChip weather={next} />}
    </div>
  );
}

/**
 * A side sheet (settings, people): titled, closed with ✕ or Escape, focus back on its button. With
 * `open`/`onOpenChange` and no `trigger` it is opened from outside (by more than one button), and focus
 * goes back to `returnFocus` (the button that opened it).
 */
function Sheet({
  title,
  trigger,
  open,
  onOpenChange,
  returnFocus,
  children,
}: {
  title: string;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  returnFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const t = useTranslations("trip");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={
            returnFocus
              ? (e) => {
                  e.preventDefault();
                  returnFocus.current?.focus();
                }
              : undefined
          }
          className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-line bg-paper p-5 shadow-3 sm:p-6"
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <Dialog.Title className="font-serif text-[22px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={iconButton} aria-label={t("close")}>
                <Icon name="close" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Loaded = { role: "owner" | "member"; members: TripMember[] };

/**
 * The people sheet's body: who is on the trip and their roles (the owner manages them, others can
 * leave), then the invite panel for the owner (who alone manages invites), else who to ask.
 */
function People({ tripId, userId }: { tripId: string; userId: string | null }) {
  const t = useTranslations("share");
  const tc = useTranslations("common");
  const ts = useTranslations("settings");
  const locale = useLocale();
  const [trip, setTrip] = useState<Loaded | "loading" | "failed">("loading");
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/trips/${tripId}`);
        const next = res.ok ? ((await res.json()) as Loaded) : "failed";
        if (live) setTrip(next);
      } catch {
        if (live) setTrip("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [tripId, version]);
  if (trip === "loading") return <p role="status">{tc("loading")}</p>;
  if (trip === "failed")
    return (
      <p role="alert" className={errorText}>
        {ts("loadFailed")}
      </p>
    );
  return (
    <div className="grid gap-6">
      {userId && Array.isArray(trip.members) && <MembersPanel tripId={tripId} members={trip.members} userId={userId} onChanged={reload} />}
      {trip.role === "owner" ? <InvitePanel tripId={tripId} locale={locale} onMembersChanged={reload} /> : <p className={hint}>{t("ownerOnly")}</p>}
    </div>
  );
}

export type UndoControls = {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
};

/** Undo or Redo: an icon, labelled in text from 1280 px, with its shortcut as a tooltip. */
function HistoryButton({ kind, keys, disabled, onClick }: { kind: "undo" | "redo"; keys: string; disabled: boolean; onClick(): void }) {
  const t = useTranslations("trip");
  return (
    <button
      type="button"
      className={`${iconButton} xl:w-auto xl:gap-1.5 xl:px-2 xl:text-[13px] xl:font-medium`}
      aria-label={t(kind)}
      title={t(kind === "undo" ? "undoTip" : "redoTip")}
      aria-keyshortcuts={keys}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={kind} />
      <span aria-hidden="true" className="hidden xl:inline">
        {t(kind)}
      </span>
    </button>
  );
}

/** Who is on the trip (the header's avatars), as the people sheet needs them. */
export type HeaderPeople = { self: MemberView | null; peers: Peer[]; members: MemberView[] };

/**
 * The trip screen's header: home, the trip's name (renamed in place) with its dates, days and places,
 * the weather strip, sync status, who is here now, undo/redo, Share and the settings (members,
 * invites, trip details), each opening as a side sheet. The avatars open the same people sheet as
 * Share (who is on the trip, roles, invites); a trip with only its owner shows "Invite friends" there.
 */
export function TripHeader({
  tripId,
  view,
  status,
  weather,
  history,
  onRename,
  settings,
  people,
}: {
  tripId: string;
  view: TripView;
  status: SyncStatus;
  weather: Record<string, DayWeather>;
  history: UndoControls | null;
  onRename: ((name: string) => void) | null;
  settings: ReactNode;
  /** Who is here now (the avatars), and who is on the trip. */
  people: HeaderPeople;
}) {
  const t = useTranslations("trip");
  const ts = useTranslations("share");
  const locale = useLocale();
  const [peopleOpen, setPeopleOpen] = useState(false);
  // The avatars or Share/Invite friends: focus goes back to the one used.
  const opener = useRef<HTMLElement | null>(null);
  const openPeople = (from: HTMLElement) => {
    opener.current = from;
    setPeopleOpen(true);
  };
  const userId = people.self?.id ?? null;
  // Only its owner so far (the creator is the first member): the call to invite friends.
  const alone = userId !== null && people.members.length === 1 && people.members[0].id === userId;
  const places = view.days.reduce((n, d) => n + d.places.length, 0);
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-3 py-2.5 sm:px-5 lg:h-16 lg:flex-nowrap lg:py-0">
      <Link href="/trips" aria-label={t("home")} className="flex h-8 items-center gap-2 text-[15px] font-bold">
        <svg viewBox="0 0 26 26" width={26} height={26} aria-hidden="true">
          <rect width="26" height="26" rx="8" fill="#1c1917" />
          <path d="M13 7a4.5 4.5 0 0 0-4.5 4.5c0 3.4 4.5 7.5 4.5 7.5s4.5-4.1 4.5-7.5A4.5 4.5 0 0 0 13 7z" stroke="#fff" strokeWidth="2.2" fill="none" />
        </svg>
        <span className="hidden sm:inline">rota</span>
      </Link>
      <div className="grid min-w-0 flex-1 basis-40 gap-px">
        <TripName name={view.name} onRename={onRename} />
        <p className="truncate text-[12.5px] text-ink-2">
          {t("summary", {
            range: dateRange(locale, view.startDate, view.days.length),
            days: view.days.length,
            places,
          })}
        </p>
      </div>
      <WeatherStrip view={view} weather={weather} />
      <div className="ml-auto flex items-center gap-1.5">
        <SyncIndicator status={status} />
        <Presence {...people} onOpen={openPeople} />
        {history && (
          <>
            <HistoryButton kind="undo" keys="Control+Z Meta+Z" disabled={!history.canUndo} onClick={history.undo} />
            <HistoryButton kind="redo" keys="Control+Shift+Z Meta+Shift+Z" disabled={!history.canRedo} onClick={history.redo} />
          </>
        )}
        <button
          type="button"
          aria-haspopup="dialog"
          data-tour="share"
          onClick={(e) => openPeople(e.currentTarget)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-ink-2"
        >
          {alone && <Icon name="plus" size={14} />}
          {alone ? ts("inviteFriends") : ts("title")}
        </button>
        <Sheet title={ts("people")} open={peopleOpen} onOpenChange={setPeopleOpen} returnFocus={opener}>
          <People tripId={tripId} userId={userId} />
        </Sheet>
        <Sheet
          title={t("settings")}
          trigger={
            <button type="button" className={iconButton} aria-label={t("settings")}>
              <Icon name="settings" />
            </button>
          }
        >
          {settings}
        </Sheet>
      </div>
    </header>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Y from "yjs";
import {
  addPlace,
  createUndo,
  deletePlace,
  isTripFull,
  movePlace,
  setDay,
  setTripMeta,
  updatePlace,
  type Leg,
  type PlaceView,
  type TripView,
  type Undo,
} from "@rota/trip";
import { useUserId } from "@/client/authClient";
import { forgetTrip } from "@/client/myTrips";
import { useTrip } from "@/client/sync/useTrip";
import { useRouter } from "@/i18n/navigation";
import { card } from "../ui";
import { AddPlace } from "./AddPlace";
import { Announcer } from "./Announcer";
import { ClosedNotice } from "./ClosedNotice";
import { Filters } from "./Filters";
import { Header } from "./Header";
import { Itinerary, type ItineraryActions } from "./Itinerary";
import { placeFocusId } from "./PlaceRow";
import { estimatedLegs, NO_FILTER, passes, plannedLists, type ListId } from "./plan";
import { TripSettingsScreen } from "./TripSettingsScreen";
import { UndoToast } from "./UndoToast";

/** What the map (Task 12) gets: the trip, and which places the filters leave visible. */
export type MapSlot = (ctx: { view: TripView; visible: (p: PlaceView) => boolean }) => ReactNode;

type Props = {
  tripId: string;
  /** Renders inside the region named "Map". Empty until the map exists. */
  mapSlot?: MapSlot;
  /** Travel legs between a day's consecutive stops, for arrival times. Defaults to straight-line estimates. */
  legsFor?: (dayId: string) => (Leg | null)[];
};

/** Per-person undo for the signed-in user; null while the user is unknown. Re-renders when the stacks change. */
function useUndo(doc: Y.Doc, userId: string | null): Undo | null {
  const [undo, setUndo] = useState<Undo | null>(null);
  const [, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (userId === null) return;
    const manager = createUndo(doc, userId);
    const off = manager.onChange(changed);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the manager lives as long as this effect
    setUndo(manager);
    return () => {
      off();
      manager.destroy();
      setUndo(null);
    };
  }, [doc, userId]);
  return undo;
}

/** True when a key press belongs to a text field or editor, whose own undo must win. */
function inEditor(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** The trip screen. Remounted when the signed-in user changes, so nothing of one user's session reaches another's. */
export function TripScreen(props: Props) {
  const userId = useUserId();
  return <TripScreenFor key={userId ?? ""} {...props} />;
}

function TripScreenFor({ tripId, mapSlot, legsFor }: Props) {
  const t = useTranslations("trip");
  const locale = useLocale();
  const router = useRouter();
  const { doc, view, status, ready, closed, firstOpenOffline, awareness, userId } = useTrip(tripId);
  // Edits need a known user (they are attributed and undone per person) and a trip that still syncs.
  const editor = closed === null ? userId : null;
  const undo = useUndo(doc, editor);
  const [filter, setFilter] = useState(NO_FILTER);
  const [toast, setToast] = useState<{ id: string; name: string; at: number } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  // The tab's title names the trip (WCAG 2.4.2).
  useEffect(() => {
    if (view.name) document.title = `${view.name} · Rota`;
  }, [view.name]);

  // Presence publishes who this connection is, so others can name the author of an edit.
  useEffect(() => {
    if (awareness && userId) awareness.setLocalStateField("user", { id: userId });
  }, [awareness, userId]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, except in text fields, which keep their own undo.
  useEffect(() => {
    if (!undo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "z" || inEditor(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) undo.redo();
      else undo.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // The toast's Undo reverts the delete only while that is still the last thing this person did: any
  // later edit of theirs, or an undo/redo elsewhere, dismisses it.
  useEffect(() => {
    if (!toast || !undo) return;
    const onTransaction = (tr: Y.Transaction) => {
      if (tr.origin === editor) setToast(null);
    };
    doc.on("afterTransaction", onTransaction);
    const off = undo.onChange(() => setToast(null));
    return () => {
      doc.off("afterTransaction", onTransaction);
      off();
    };
  }, [toast, undo, doc, editor]);

  const full = useMemo(() => isTripFull(view, Y.encodeStateAsUpdate(doc).byteLength), [view, doc]);
  const visible = useCallback((p: PlaceView) => passes(filter, p), [filter]);
  const hidden = plannedLists(view).reduce((n, l) => n + l.places.filter((p) => !visible(p)).length, 0);
  const legs =
    legsFor ??
    ((dayId: string) => {
      const day = view.days.find((d) => d.id === dayId);
      return day ? estimatedLegs(day) : [];
    });

  const labelIn = useCallback(
    (v: TripView, list: ListId) => {
      const index = v.days.findIndex((d) => d.id === list);
      return list === null || index < 0 ? t("ideas") : t("day", { n: index + 1 });
    },
    [t],
  );
  const dayDate = (date: string) =>
    date ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "";

  if (closed)
    return (
      <ClosedNotice
        reason={closed}
        tripId={tripId}
        onRemove={async () => {
          if (userId) await forgetTrip(tripId, userId).catch(() => undefined);
          router.push("/trips");
        }}
      />
    );

  if (!ready)
    return (
      <main id="main" className="mx-auto grid min-h-dvh max-w-md content-center px-4 py-10">
        {firstOpenOffline ? (
          <div className={`${card} grid gap-2`}>
            <h1 className="text-[16px] font-semibold">{t("firstOpenOffline")}</h1>
            <p className="text-ink-2">{t("firstOpenOfflineHelp")}</p>
          </div>
        ) : (
          <p role="status" className="text-center text-ink-2">
            {t("loading")}
          </p>
        )}
      </main>
    );

  const actions: ItineraryActions | null = editor === null ? null : {
    save: (id, edit) => updatePlace(doc, id, edit, editor),
    setStay: (id, stayMinutes) => updatePlace(doc, id, { stayMinutes }, editor),
    nudge(id, by) {
      const list = plannedLists(view).find((l) => l.places.some((p) => p.id === id));
      if (!list) return;
      const neighbour = list.places[list.places.findIndex((p) => p.id === id) + by];
      if (neighbour) movePlace(doc, id, by < 0 ? { dayId: list.id, beforeId: neighbour.id } : { dayId: list.id, afterId: neighbour.id }, editor);
    },
    openMove: () => undefined,
    move: (id, to) => movePlace(doc, id, to, editor),
    remove(place) {
      // Its own undo step, so the toast's Undo restores just the place.
      undo?.stopCapturing();
      deletePlace(doc, place.id, editor);
      setToast({ id: place.id, name: place.name || t("unnamed"), at: Date.now() });
    },
    setDay: (dayId, patch) => setDay(doc, dayId, patch, editor),
  };
  const lists = plannedLists(view).map((l) => ({ id: l.id, label: labelIn(view, l.id) }));

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <Header
        view={view}
        status={status}
        history={undo && { canUndo: undo.canUndo(), canRedo: undo.canRedo(), undo: undo.undo, redo: undo.redo }}
        onRename={editor === null ? null : (name) => setTripMeta(doc, { name }, editor)}
        settings={<TripSettingsScreen tripId={tripId} />}
      />
      {editor === null && <p className="border-b border-warn-line bg-warn-bg px-4 py-2 text-[13px] text-warn-ink">{t("readOnly")}</p>}
      <div className="grid flex-1 lg:min-h-0 lg:grid-cols-[440px_minmax(0,1fr)]">
        <main id="main" tabIndex={-1} aria-label={t("plan")} className="min-w-0 pb-24 outline-none lg:overflow-y-auto lg:border-r lg:border-line">
          {editor !== null && <AddPlace lists={lists} full={full} onAdd={(name, dayId) => addPlace(doc, { name, category: "other", dayId }, editor)} />}
          <Filters view={view} filter={filter} hidden={hidden} onChange={setFilter} />
          <Itinerary view={view} visible={visible} legsFor={legs} listLabel={(list) => labelIn(view, list)} dayDate={dayDate} actions={actions} />
        </main>
        <section aria-label={t("map")} className="hidden bg-[#f1efe9] lg:block">
          {mapSlot?.({ view, visible })}
        </section>
      </div>
      {toast && undo && (
        <UndoToast
          key={toast.at}
          name={toast.name}
          onClose={closeToast}
          onUndo={() => {
            undo.undo();
            setToast(null);
            requestAnimationFrame(() => document.getElementById(placeFocusId(toast.id))?.focus());
          }}
        />
      )}
      <Announcer doc={doc} userId={userId} awareness={awareness} listLabel={labelIn} />
    </div>
  );
}

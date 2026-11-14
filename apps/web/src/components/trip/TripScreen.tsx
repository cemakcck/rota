"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useLocale, useTranslations } from "next-intl";
import * as Y from "yjs";
import {
  addChecklistItem,
  addPlace,
  createUndo,
  dayTimeline,
  deleteChecklistItem,
  deletePlace,
  isChecklistFull,
  isTripFull,
  moveChecklistItem,
  movePlace,
  readTrip,
  setDay,
  setPlaceStatus,
  setPlaceTime,
  shiftDayTimes,
  vote,
  setTripMeta,
  updateChecklistItem,
  updatePlace,
  type Locale,
  type PlaceView,
  type TripView,
  type Undo,
} from "@rota/trip";
import { useUserId } from "@/client/authClient";
import { forgetTrip } from "@/client/myTrips";
import { setUser, usePeers } from "@/client/presence";
import { useTrip } from "@/client/sync/useTrip";
import { reverseGeocode } from "@/client/geocode";
import { useHours } from "@/client/useHours";
import { useTravels } from "@/client/useTravel";
import { useWeather } from "@/client/useWeather";
import { useRouter } from "@/i18n/navigation";
import type { FriendWindow } from "../demo/FriendButton";
import { SideBySide } from "../demo/SideBySide";
import { BottomSheet, type Snap } from "../map/BottomSheet";
import { dayColour } from "../map/mapFeatures";
import { TripMap } from "../map/TripMap";
import { card } from "../ui";
import { ActionToastProvider, useActionToast } from "./ActionToast";
import { Announcer } from "./Announcer";
import { Checklist, checkFocusId, type ChecklistActions } from "./Checklist";
import { ClosedNotice } from "./ClosedNotice";
import { DayPlan, SILENT, signedMinutes, type PlanActions } from "./DayPlan";
import { DemoBox } from "./DemoBox";
import { MoveDialog } from "./MoveDialog";
import { PlaceDetails, type DetailsWhere } from "./PlaceDetails";
import { usePlaceControls } from "./placeControls";
import { CollabContext, Presence, type Collab } from "./Presence";
import { NO_FILTER, dropPlace, moveKeepingTime, passes, plannedLists, tripCentre, type ListId } from "./plan";
import { placeFocusId, placeMoveId, placeRowId } from "./StopRow";
import { Rail } from "./Rail";
import { suggestedFor, type NewStop, type PreviewPlace } from "./SearchBar";
import { TripHeader } from "./TripHeader";
import { TripSettingsScreen } from "./TripSettingsScreen";
import { useTripView } from "./view";

type Props = { tripId: string };

/** How long a just-added stop stays highlighted. */
export const ADDED_HIGHLIGHT_MS = 2000;

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

/**
 * True when Ctrl/Cmd+Z is not for the trip: typing in a field or an open note (its own undo wins), or
 * while a dialog (settings, Move to…) is open, where undoing would change the trip unseen.
 */
function notForTrip(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return true;
  // An open note (its toolbar too): the note's own undo, or nothing.
  if (target instanceof Element && target.closest("[data-note-editor]")) return true;
  return document.querySelector('[role="dialog"]') !== null;
}

/** The trip screen. Remounted when the signed-in user changes, so nothing of one user's session reaches another's. */
export function TripScreen(props: Props) {
  const userId = useUserId();
  return (
    <ActionToastProvider key={userId ?? ""}>
      <TripScreenFor {...props} />
    </ActionToastProvider>
  );
}

function TripScreenFor({ tripId }: Props) {
  const t = useTranslations("trip");
  const tm = useTranslations("map");
  const locale = useLocale();
  const router = useRouter();
  const { doc, view, status, ready, closed, firstOpenOffline, awareness, userId, simulateOffline } = useTrip(tripId);
  // Edits need a known user (they are attributed and undone per person) and a trip that still syncs.
  const editor = closed === null ? userId : null;
  const undo = useUndo(doc, editor);
  const [filter, setFilter] = useState(NO_FILTER);
  // What the list and the map show (mirrored in the address), and the place selected in the list or on the map.
  const [shown, show] = useTripView(view, ready);
  const [picked, setPicked] = useState<string | null>(null);
  // The place whose details panel is open (a row or pin opened it).
  const [openId, setOpenId] = useState<string | null>(null);
  // Phones: the full-screen map under the list's sheet, or the list alone.
  const [phoneView, setPhoneView] = useState<"map" | "list">("map");
  const [snap, setSnap] = useState<Snap>("half");
  // Demo trips on wide screens: the friend's window beside this one.
  const [friend, setFriend] = useState<FriendWindow | null>(null);
  // The place being dragged: rows drop on rows, on lists, and on the rail's days and Ideas.
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [offscreen] = useState(() => (typeof document === "undefined" ? undefined : document.createElement("div")));
  // The one toast of the screen (Undo for a delete, an add, …).
  const toast = useActionToast();
  const { dismiss: dismissToast } = toast;
  const toastShown = toast.current !== null;
  // A stop just added (highlighted for a moment), and the search result previewed on the map.
  const [highlight, setHighlight] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPlace | null>(null);
  // The place under the pointer, in the list or on the map: its row and its pin are highlighted together.
  const [hovered, setHovered] = useState<string | null>(null);
  // Who is here and what they edit; map cursors stay out, so their moves do not re-render the screen.
  const peers = usePeers(awareness, userId, { cursors: false });
  const self = view.members.find((m) => m.id === userId);

  // The tab's title names the trip (WCAG 2.4.2).
  useEffect(() => {
    if (view.name) document.title = `${view.name} · Rota`;
  }, [view.name]);

  // Presence publishes who this connection is: for avatars, outlines and carets, and so others can
  // name the author of an edit.
  useEffect(() => {
    if (awareness && userId) setUser(awareness, { id: userId, name: self?.name ?? "", colour: self?.colour ?? "" });
  }, [awareness, userId, self?.name, self?.colour]);
  const collab = useMemo<Collab>(() => ({ doc, awareness, editor, peers, members: view.members }), [doc, awareness, editor, peers, view.members]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, except in text fields, which keep their own undo.
  useEffect(() => {
    if (!undo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "z" || notForTrip(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) undo.redo();
      else undo.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // The toast's Undo reverts the action only while that is still the last thing this person did: any
  // later edit of theirs, or an undo/redo elsewhere, dismisses it. Others' edits do not (their changes
  // are not on this person's undo stack, so Undo never reverts them).
  useEffect(() => {
    if (!toastShown || !undo) return;
    const onTransaction = (tr: Y.Transaction) => {
      if (tr.origin === editor) dismissToast();
    };
    doc.on("afterTransaction", onTransaction);
    const off = undo.onChange(dismissToast);
    return () => {
      doc.off("afterTransaction", onTransaction);
      off();
    };
  }, [toastShown, undo, doc, editor, dismissToast]);

  useEffect(() => {
    if (highlight === null) return;
    const timer = setTimeout(() => setHighlight(null), ADDED_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight]);

  const full = useMemo(() => isTripFull(view, Y.encodeStateAsUpdate(doc).byteLength), [view, doc]);
  const visible = useCallback((p: PlaceView) => passes(filter, p), [filter]);
  const hiddenIds = useMemo(() => new Set(plannedLists(view).flatMap((l) => l.places.filter((p) => !visible(p)).map((p) => p.id))), [view, visible]);
  // Travel times and road routes, opening hours and weather, through our proxies (estimates offline).
  const travel = useTravels(view);
  const legsFor = useCallback((dayId: string) => travel[dayId]?.legs ?? [], [travel]);
  const { warnings, open: openingHours } = useHours(view, legsFor, locale as Locale);
  const weather = useWeather(view);
  const routeGeometry = useMemo(() => Object.fromEntries(Object.entries(travel).flatMap(([id, d]) => (d.geometry ? [[id, d.geometry]] : []))), [travel]);
  const centre = useMemo(() => tripCentre(view), [view]);

  const labelIn = useCallback(
    (v: TripView, list: ListId) => {
      const index = v.days.findIndex((d) => d.id === list);
      return list === null || index < 0 ? t("ideas") : t("day", { n: index + 1 });
    },
    [t],
  );
  const dayDate = (date: string) =>
    date ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "";


  // Selection, shared by the list and the map. A place removed meanwhile is no longer selected.
  const listOf = (id: string) => plannedLists(view).find((l) => l.places.some((p) => p.id === id));
  const selectedPlaceId = picked !== null && listOf(picked) ? picked : null;
  // The details follow their place: gone (deleted, or un-planned) they close; moved to another list
  // (by anyone), the view goes with it. Choosing a view that does not show the place closes them.
  const openList = openId === null ? undefined : listOf(openId);
  if (openId !== null && !openList) setOpenId(null);
  const openListId = openList?.id;
  const shownKey = shown.kind === "day" ? `day:${shown.dayId}` : shown.kind;
  const [seen, setSeen] = useState({ id: openId, list: openListId, shown: shownKey });
  if (seen.id !== openId || seen.list !== openListId || seen.shown !== shownKey) {
    setSeen({ id: openId, list: openListId, shown: shownKey });
    const moved = seen.id === openId && seen.list !== openListId;
    const showsIt = shown.kind === "all" || (shown.kind === "ideas" ? openListId === null : shown.kind === "day" && openListId === shown.dayId);
    if (openId !== null && openListId !== undefined && seen.shown !== shownKey && !moved && !showsIt) setOpenId(null);
  }
  // The hovered place, while it is shown: gone from the view (deleted, moved, another view chosen) with
  // no pointerleave, it is forgotten, so it does not come back hovered.
  const shownPlaces = shown.kind === "all" ? plannedLists(view) : plannedLists(view).filter((l) => (shown.kind === "ideas" ? l.id === null : shown.kind === "day" && l.id === shown.dayId));
  if (hovered !== null && !shownPlaces.some((l) => l.places.some((p) => p.id === hovered))) setHovered(null);
  const followed = useRef<{ id: string; list: string | null } | null>(null);
  useEffect(() => {
    const was = followed.current;
    followed.current = openId === null || openListId === undefined ? null : { id: openId, list: openListId };
    if (!was || was.id !== openId || openListId === undefined || was.list === openListId || shown.kind === "all") return;
    show(openListId === null ? { kind: "ideas" } : { kind: "day", dayId: openListId });
  }, [openId, openListId, shown.kind, show]);

  // An add by this person: its own undo step, the new row highlighted, focused and scrolled to when it
  // is shown, and a toast saying where it went, whose Undo removes just that place.
  const addOwn = (put: () => string, name: string, to: ListId | "suggest", time: string | null): string => {
    undo?.stopCapturing();
    const id = put();
    undo?.stopCapturing();
    const list = to === "suggest" ? "" : labelIn(view, to);
    toast.show({
      message: to === "suggest" ? t("addedSuggestion", { name }) : time ? t("addedToAt", { list, time }) : t("addedTo", { list }),
      undoLabel: t("undoAddFor", { name }),
      // This person's undo step: the add only, never a friend's edit (no Undo without the manager).
      onUndo: undo ? () => undo.undo() : undefined,
    });
    setHighlight(id);
    requestAnimationFrame(() => {
      const row = document.getElementById(placeRowId(id));
      if (!row) return;
      const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      row.scrollIntoView?.({ block: "nearest", behavior });
      document.getElementById(placeFocusId(id))?.focus();
    });
    return id;
  };
  const addStop = ({ time, ...place }: NewStop, to: ListId | "suggest", origin: string) =>
    addOwn(
      () => (to === "suggest" ? addPlace(doc, { ...place, dayId: null, status: "suggested" }, origin) : addPlace(doc, { ...place, dayId: to, time }, origin)),
      place.name.trim(),
      to,
      to === null || to === "suggest" ? null : time,
    );

  const actions: PlanActions | null = editor === null ? null : {
    save: (id, edit) => updatePlace(doc, id, edit, editor),
    setTime: (id, time) => void setPlaceTime(doc, id, time, editor),
    // Set by the plan (it knows the neighbours and says what happened).
    nudge: () => undefined,
    openMove: () => undefined,
    // A move to a slot (Alt+arrows, Move up/down) re-times a timed stop for it (spec §2b); Move to…
    // keeps a set time and slots the stop by it in the new day (ruling F1).
    move: (id, to) => movePlace(doc, id, to, editor, { retime: true }),
    moveTo: (id, dayId) => moveKeepingTime(doc, id, dayId, editor),
    add: (stop, to) => void addStop(stop, to, editor),
    remove(place) {
      // Its own undo step, so the toast's Undo restores just the place.
      undo?.stopCapturing();
      deletePlace(doc, place.id, editor);
      showDeleted(place.name || t("unnamed"), placeFocusId(place.id));
    },
    setDay: (dayId, patch) => setDay(doc, dayId, patch, editor),
    shiftTimes: (dayId, minutes) => shiftTimes(dayId, minutes, editor),
    vote: (id, value) => vote(doc, id, editor, value),
    // One transaction (one undo step, one announcement): planned, then into the chosen list; into a day
    // at the chosen time (to its place by time) and with the chosen stay.
    accept: (id, to, timing) =>
      doc.transact(() => {
        setPlaceStatus(doc, id, "planned", editor);
        if (!movePlace(doc, id, { dayId: to }, editor) || to === null || !timing) return;
        setPlaceTime(doc, id, timing.time, editor);
        updatePlace(doc, id, { stayMinutes: timing.stayMinutes }, editor);
      }, editor),
    dismiss: (id) => setPlaceStatus(doc, id, "dismissed", editor),
    // An idea into a day, at its time (or untimed) and with its stay: one transaction, one undo step.
    schedule: (id, dayId, time, stayMinutes) =>
      doc.transact(() => {
        if (!movePlace(doc, id, { dayId }, editor)) return;
        setPlaceTime(doc, id, time, editor);
        updatePlace(doc, id, { stayMinutes }, editor);
      }, editor),
    restore: (id) => setPlaceStatus(doc, id, "suggested", editor),
  };
  const controls = usePlaceControls(doc, view, actions);

  // Every set time of a day moved at once: its own undo step, and a toast saying how many moved and which
  // stopped at 00:00 / 23:59, whose Undo reverts just that.
  function shiftTimes(dayId: string, minutes: number, origin: string) {
    const before = view.days.find((d) => d.id === dayId);
    if (!before) return;
    undo?.stopCapturing();
    const { clamped } = shiftDayTimes(doc, dayId, minutes, origin);
    undo?.stopCapturing();
    const after = new Map(readTrip(doc).days.find((d) => d.id === dayId)?.places.map((p) => [p.id, p.time]));
    const moved = before.places.filter((p) => p.time !== null && after.has(p.id) && after.get(p.id) !== p.time).length;
    const limit = minutes < 0 ? "00:00" : "23:59";
    const day = labelIn(view, dayId);
    if (moved === 0) return toast.show({ message: t("shiftUnchanged", { time: limit }) });
    const message = [t("shifted", { count: moved, minutes: signedMinutes(minutes) }), clamped.length > 0 ? t("shiftClamped", { count: clamped.length, time: limit }) : ""];
    toast.show({
      message: message.filter(Boolean).join(" "),
      undoLabel: t("undoShiftFor", { day }),
      onUndo: undo ? () => undo.undo() : undefined,
    });
  }

  // "Galata Tower deleted. Undo": focus moves to Undo (the row's buttons are gone), and back to the restored row after.
  function showDeleted(name: string, focus: string) {
    toast.show({
      message: t("deleted", { name }),
      undoLabel: t("undoDeleteFor", { name }),
      focus: true,
      onUndo: undo
        ? () => {
            undo.undo();
            requestAnimationFrame(() => document.getElementById(focus)?.focus());
          }
        : undefined,
    });
  }

  if (closed)
    return (
      <ClosedNotice
        reason={closed}
        pending={status.pending}
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

  const checklistActions: ChecklistActions | null = editor === null ? null : {
    add: (text) => addChecklistItem(doc, text, editor),
    update: (id, patch) => updateChecklistItem(doc, id, patch, editor),
    move: (id, to) => moveChecklistItem(doc, id, to, editor),
    remove(item) {
      undo?.stopCapturing();
      deleteChecklistItem(doc, item.id, editor);
      showDeleted(item.text || t("untitledItem"), checkFocusId(item.id));
    },
  };
  const lists = plannedLists(view).map((l) => ({ id: l.id, label: labelIn(view, l.id) }));

  // Selecting a place shows its list (its day, or Ideas), unless the whole trip is shown.
  const select = (id: string) => {
    setPicked(id);
    const list = listOf(id);
    if (!list || shown.kind === "all") return;
    show(list.id === null ? { kind: "ideas" } : { kind: "day", dayId: list.id });
  };
  // A row or a pin opens the place's details; closing them puts focus back on its row.
  const openDetails = (id: string) => {
    select(id);
    setOpenId(id);
  };
  const closeDetails = () => {
    const id = openId;
    setOpenId(null);
    if (id !== null) requestAnimationFrame(() => document.getElementById(placeFocusId(id))?.focus());
  };
  // A click on the empty map closes the details (the place stays selected); focus goes back to its row
  // only if it was in the panel, so a pointer click elsewhere is not followed by a jump.
  const closeOnMapClick = () => {
    if (openId === null) return;
    if (document.activeElement?.closest("#place-details")) closeDetails();
    else setOpenId(null);
  };
  // A pin: its row is selected and brought into view (the sheet comes up if it was down), its details open.
  const selectPin = (id: string) => {
    openDetails(id);
    if (snap === "peek") setSnap("half");
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    requestAnimationFrame(() => document.getElementById(placeRowId(id))?.scrollIntoView?.({ block: "nearest", behavior }));
  };

  const choices = plannedLists(view).map((l) => ({
    id: l.id,
    label: l.id === null ? t("ideas") : `${labelIn(view, l.id)} · ${dayDate(view.days.find((d) => d.id === l.id)!.date)}`,
  }));

  // The open place's details: where it is (its day's number, timeline and travel, or Ideas), who added it, its hours.
  let details = null;
  if (openId !== null && openList) {
    const index = openList.places.findIndex((p) => p.id === openId);
    const place = openList.places[index];
    const day = view.days.find((d) => d.id === openList.id);
    let where: DetailsWhere = { kind: "ideas", label: t("ideas") };
    if (day) {
      const dayTravel = travel[day.id];
      const timing = dayTimeline(day, dayTravel?.legs ?? [])[index];
      const leg = index > 0 ? dayTravel?.legs[index - 1] : undefined;
      // As on the row: a late arrival is only said once the travel before it is known.
      const late = timing?.lateBy && !(leg?.approximate && dayTravel?.loading) ? { minutes: timing.lateBy, from: day.places[index - 1]?.name || t("unnamed") } : null;
      where = { kind: "day", label: labelIn(view, day.id), number: index + 1, colour: dayColour(day.index), mode: day.travelMode, timing, leg, late };
    }
    details = (
      <PlaceDetails
        key={place.id}
        place={place}
        where={where}
        addedBy={view.members.find((m) => m.id === place.addedBy)}
        hours={openingHours.get(place.id)}
        warning={warnings.get(place.id)}
        first={index === 0}
        last={index === openList.places.length - 1}
        actions={controls.stopActions}
        onClose={closeDetails}
      />
    );
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (editor === null || !over) return;
    const id = String(active.id);
    const from = listOf(id)?.id;
    if (dropPlace(doc, view, id, String(over.id), editor) && from !== undefined) controls.sayMoved(id, from);
  };
  const dragged = dragging === null ? undefined : listOf(dragging)?.places.find((p) => p.id === dragging);

  return (
    <CollabContext.Provider value={collab}>
      <SideBySide friend={friend} onClose={() => setFriend(null)}>
        <DndContext
          accessibility={{ announcements: SILENT, screenReaderInstructions: { draggable: "" }, container: offscreen }}
          sensors={sensors}
          onDragStart={({ active }) => setDragging(String(active.id))}
          onDragCancel={() => setDragging(null)}
          onDragEnd={onDragEnd}
        >
          <div className="flex h-dvh flex-col bg-paper">
            <TripHeader
              tripId={tripId}
              view={view}
              status={status}
              weather={weather}
              history={undo && { canUndo: undo.canUndo(), canRedo: undo.canRedo(), undo: undo.undo, redo: undo.redo }}
              onRename={editor === null ? null : (name) => setTripMeta(doc, { name }, editor)}
              settings={<TripSettingsScreen tripId={tripId} />}
              presence={<Presence self={userId ? (self ?? { id: userId, name: "", colour: "" }) : null} peers={peers} members={view.members} />}
            />
            {editor === null && <p className="border-b border-warn-line bg-warn-bg px-4 py-2 text-[13px] text-warn-ink">{t("readOnly")}</p>}
            <div role="group" aria-label={tm("view")} className="flex justify-end gap-1 border-b border-line bg-surface px-3 py-1.5 lg:hidden">
              {(["list", "map"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={phoneView === v}
                  onClick={() => setPhoneView(v)}
                  className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-ink-2 aria-pressed:bg-ink aria-pressed:text-white"
                >
                  {v === "list" ? tm("showList") : tm("showMap")}
                </button>
              ))}
            </div>
            {/* Desktop: rail · list · map. Phones (until their own layout): the rail as a strip above the sheet and map. */}
            <div className="relative flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[208px_400px_minmax(0,1fr)]">
              <Rail
                tripId={tripId}
                trip={view}
                selected={shown}
                onSelect={show}
                canAddDay={editor !== null}
                demo={view.isDemo ? <DemoBox tripId={tripId} simulateOffline={simulateOffline} onSideBySide={setFriend} /> : undefined}
              />
              <div className="relative flex min-h-0 flex-1 flex-col lg:contents">
                <BottomSheet off={phoneView === "list"} snap={snap} onSnap={setSnap}>
                  <main
                    id="main"
                    tabIndex={-1}
                    aria-label={shown.kind === "checklist" ? t("checklist") : t("plan")}
                    className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pb-24 outline-none max-lg:flex-1 lg:border-r lg:border-line"
                  >
                    {shown.kind === "checklist" ? (
                      <Checklist items={view.checklist} members={view.members} full={isChecklistFull(view)} actions={checklistActions} />
                    ) : (
                      <DayPlan
                        view={view}
                        shown={shown}
                        travel={travel}
                        warnings={warnings}
                        filter={filter}
                        onFilter={setFilter}
                        hidden={hiddenIds.size}
                        visible={visible}
                        selectedId={selectedPlaceId}
                        openId={openId}
                        onOpen={(id, open) => (open ? openDetails(id) : closeDetails())}
                        actions={actions}
                        stopActions={controls.stopActions}
                        onSchedule={controls.schedule}
                        full={full}
                        near={centre}
                        listLabel={(list) => labelIn(view, list)}
                        dayDate={dayDate}
                        userId={editor}
                        highlightId={highlight}
                        onPreview={setPreview}
                        hoveredId={hovered}
                        onHover={setHovered}
                      />
                    )}
                  </main>
                </BottomSheet>
                <section aria-label={t("map")} className={`relative min-h-0 max-lg:absolute max-lg:inset-0 ${phoneView === "list" ? "max-lg:hidden" : ""}`}>
                  <TripMap
                    view={view}
                    hiddenIds={hiddenIds}
                    // The checklist has no places: the map shows the whole trip meanwhile.
                    shown={shown.kind === "checklist" ? { kind: "all" } : shown}
                    selectedPlaceId={selectedPlaceId}
                    panel={details !== null}
                    onSelectPlace={selectPin}
                    routeGeometry={routeGeometry}
                    awareness={awareness}
                    userId={userId}
                    add={
                      editor === null || full
                        ? null
                        : {
                            lists,
                            reverseGeocode,
                            suggest: (dayId, at) => suggestedFor(view.days.find((d) => d.id === dayId), legsFor(dayId), at),
                            onAdd: (place) => select(addOwn(() => addPlace(doc, place, editor), place.name.trim(), place.dayId, place.dayId === null ? null : place.time)),
                          }
                    }
                    sheet={phoneView === "map" ? snap : null}
                    preview={preview}
                    hoveredPlaceId={hovered}
                    onHoverPlace={setHovered}
                    onMapClick={closeOnMapClick}
                  />
                  {status.kind === "offline" && (
                    <p className="pointer-events-none absolute right-14 top-3 z-[3] rounded-lg border border-warn-line bg-warn-bg px-2.5 py-1 text-[12.5px] text-warn-ink shadow-1">
                      {tm("incompleteOffline")}
                    </p>
                  )}
                </section>
              </div>
              {/* Over the map's left edge (wide screens), or a full-height sheet (phones). */}
              {details}
            </div>
            <p data-testid="plan-status" role="status" aria-live="polite" className="sr-only">
              {controls.status}
            </p>
            {controls.moving && actions && (
              <MoveDialog
                place={controls.moving.place}
                current={controls.moving.list}
                lists={choices}
                onClose={() => {
                  const id = controls.moving!.place.id;
                  controls.closeMove();
                  requestAnimationFrame(() => document.getElementById(placeMoveId(id))?.focus());
                }}
                onMove={(to) => {
                  const id = controls.moving!.place.id;
                  controls.moveTo(id, to);
                  controls.closeMove();
                  requestAnimationFrame(() => (document.getElementById(placeMoveId(id)) ?? document.getElementById(placeFocusId(id)))?.focus());
                }}
              />
            )}
            <Announcer doc={doc} userId={userId} awareness={awareness} listLabel={labelIn} />
          </div>
          <DragOverlay dropAnimation={null}>
            {dragged && (
              <div className="rounded-xl border border-ink bg-surface px-3 py-2 text-[14px] font-semibold shadow-2 [overflow-wrap:anywhere]">{dragged.name || t("unnamed")}</div>
            )}
          </DragOverlay>
        </DndContext>
      </SideBySide>
    </CollabContext.Provider>
  );
}

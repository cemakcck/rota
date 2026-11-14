"use client";

import { useCallback, useEffect, useId, useMemo, useReducer, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Y from "yjs";
import {
  addChecklistItem,
  addPlace,
  createUndo,
  deleteChecklistItem,
  deletePlace,
  isChecklistFull,
  isTripFull,
  moveChecklistItem,
  movePlace,
  setDay,
  setPlaceStatus,
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
import type { DayWeather } from "@/client/useWeather";
import { forgetTrip } from "@/client/myTrips";
import { setUser, usePeers } from "@/client/presence";
import { useTrip } from "@/client/sync/useTrip";
import { reverseGeocode } from "@/client/geocode";
import { useHours } from "@/client/useHours";
import { useTravels } from "@/client/useTravel";
import { useWeather } from "@/client/useWeather";
import { useRouter } from "@/i18n/navigation";
import { DemoBanner } from "../demo/DemoBanner";
import type { FriendWindow } from "../demo/FriendButton";
import { SideBySide } from "../demo/SideBySide";
import { BottomSheet, type Snap } from "../map/BottomSheet";
import { TripMap } from "../map/TripMap";
import { card } from "../ui";
import { AddPlace } from "./AddPlace";
import { Announcer } from "./Announcer";
import { Checklist, checkFocusId, type ChecklistActions } from "./Checklist";
import { ClosedNotice } from "./ClosedNotice";
import { Filters } from "./Filters";
import { Header } from "./Header";
import { Itinerary, type ItineraryActions } from "./Itinerary";
import { placeFocusId, placeRowId } from "./PlaceRow";
import { CollabContext, Presence, type Collab } from "./Presence";
import { NO_FILTER, passes, plannedLists, tripCentre, type ListId } from "./plan";
import { TripSettingsScreen } from "./TripSettingsScreen";
import { UndoToast } from "./UndoToast";
import { WeatherChip } from "./WeatherChip";

type Props = { tripId: string };

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
 * while a dialog (settings, Move to…) or a place editor is open, where undoing would change the trip
 * unseen.
 */
function notForTrip(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return true;
  // An open note (its toolbar too): the note's own undo, or nothing.
  if (target instanceof Element && target.closest("[data-note-editor]")) return true;
  return document.querySelector('[role="dialog"], [data-place-editor]') !== null;
}

type Tab = "plan" | "checklist";
const TABS: Tab[] = ["plan", "checklist"];

/** The plan / checklist switch: an ARIA tablist (arrow keys, Home and End move between tabs). */
function Tabs({ id, tab, onTab, labels }: { id: string; tab: Tab; onTab: (tab: Tab) => void; labels: Record<Tab, ReactNode> }) {
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const to = TABS[(next + TABS.length) % TABS.length];
    onTab(to);
    document.getElementById(`${id}-${to}-tab`)?.focus();
  };
  return (
    <div role="tablist" className="flex gap-1 border-b border-line px-3 pt-1" onKeyDown={onKeyDown}>
      {TABS.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          id={`${id}-${name}-tab`}
          aria-selected={tab === name}
          aria-controls={`${id}-${name}`}
          tabIndex={tab === name ? 0 : -1}
          className="-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13.5px] font-medium text-ink-2 aria-selected:border-ink aria-selected:text-ink"
          onClick={() => onTab(name)}
        >
          {labels[name]}
        </button>
      ))}
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
    <div role="group" aria-label={tw("label")} className="hidden gap-1.5 md:flex">
      {days.length > 0 ? days.map((d) => <WeatherChip key={d.id} weather={weather[d.date]} day={d.date} />) : next && <WeatherChip weather={next} />}
    </div>
  );
}

/** The trip screen. Remounted when the signed-in user changes, so nothing of one user's session reaches another's. */
export function TripScreen(props: Props) {
  const userId = useUserId();
  return <TripScreenFor key={userId ?? ""} {...props} />;
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
  const [tab, setTab] = useState<Tab>("plan");
  // The map's day (undefined until one is picked: then the first), and the place selected in the list or on the map.
  const [pickedDay, setPickedDay] = useState<string | null | undefined>(undefined);
  const [picked, setPicked] = useState<string | null>(null);
  // Phones: the full-screen map under the list's sheet, or the list alone.
  const [phoneView, setPhoneView] = useState<"map" | "list">("map");
  const [snap, setSnap] = useState<Snap>("half");
  // Demo trips on wide screens: the friend's window beside this one.
  const [friend, setFriend] = useState<FriendWindow | null>(null);
  const tabsId = useId();
  // What was deleted, and the element its Undo puts focus back on.
  const [toast, setToast] = useState<{ name: string; focus: string; at: number } | null>(null);
  // Who is here and what they edit; map cursors stay out, so their moves do not re-render the screen.
  const peers = usePeers(awareness, userId, { cursors: false });
  const self = view.members.find((m) => m.id === userId);
  const closeToast = useCallback(() => setToast(null), []);

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
  const hiddenIds = useMemo(() => new Set(plannedLists(view).flatMap((l) => l.places.filter((p) => !visible(p)).map((p) => p.id))), [view, visible]);
  // Travel times and road routes, opening hours and weather, through our proxies (estimates offline).
  const travel = useTravels(view);
  const legsFor = useCallback((dayId: string) => travel[dayId]?.legs ?? [], [travel]);
  const warnings = useHours(view, legsFor, locale as Locale);
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
      setToast({ name: place.name || t("unnamed"), focus: placeFocusId(place.id), at: Date.now() });
    },
    setDay: (dayId, patch) => setDay(doc, dayId, patch, editor),
    vote: (id, value) => vote(doc, id, editor, value),
    // One transaction (one undo step, one announcement): planned, then into the chosen list.
    accept: (id, to) =>
      doc.transact(() => {
        setPlaceStatus(doc, id, "planned", editor);
        movePlace(doc, id, { dayId: to }, editor);
      }, editor),
    dismiss: (id) => setPlaceStatus(doc, id, "dismissed", editor),
    restore: (id) => setPlaceStatus(doc, id, "suggested", editor),
  };
  const checklistActions: ChecklistActions | null = editor === null ? null : {
    add: (text) => addChecklistItem(doc, text, editor),
    update: (id, patch) => updateChecklistItem(doc, id, patch, editor),
    move: (id, to) => moveChecklistItem(doc, id, to, editor),
    remove(item) {
      undo?.stopCapturing();
      deleteChecklistItem(doc, item.id, editor);
      setToast({ name: item.text || t("untitledItem"), focus: checkFocusId(item.id), at: Date.now() });
    },
  };
  const done = view.checklist.filter((i) => i.done).length;
  const lists = plannedLists(view).map((l) => ({ id: l.id, label: labelIn(view, l.id) }));

  // Selection, shared by the list and the map. A day or place removed meanwhile is no longer selected.
  const selectedDayId = pickedDay === undefined ? (view.days[0]?.id ?? null) : view.days.some((d) => d.id === pickedDay) ? pickedDay : null;
  const listOf = (id: string) => plannedLists(view).find((l) => l.places.some((p) => p.id === id));
  const selectedPlaceId = picked !== null && listOf(picked) ? picked : null;
  const select = (id: string) => {
    setPicked(id);
    const day = listOf(id)?.id;
    if (day) setPickedDay(day);
  };
  // A pin: its row is selected and brought into view (the sheet comes up if it was down).
  const selectPin = (id: string) => {
    select(id);
    setTab("plan");
    if (snap === "peek") setSnap("half");
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    requestAnimationFrame(() => document.getElementById(placeRowId(id))?.scrollIntoView?.({ block: "nearest", behavior }));
  };

  return (
    <CollabContext.Provider value={collab}>
      <SideBySide friend={friend} onClose={() => setFriend(null)}>
        <div className="flex h-dvh flex-col">
          <Header
            view={view}
            status={status}
            history={undo && { canUndo: undo.canUndo(), canRedo: undo.canRedo(), undo: undo.undo, redo: undo.redo }}
            onRename={editor === null ? null : (name) => setTripMeta(doc, { name }, editor)}
            settings={<TripSettingsScreen tripId={tripId} />}
            presence={<Presence self={userId ? (self ?? { id: userId, name: "", colour: "" }) : null} peers={peers} members={view.members} />}
            weather={<WeatherStrip view={view} weather={weather} />}
          />
          {view.isDemo && <DemoBanner tripId={tripId} simulateOffline={simulateOffline} onSideBySide={setFriend} />}
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
          <div className="relative grid min-h-0 flex-1 lg:grid-cols-[420px_minmax(0,1fr)]">
            <BottomSheet off={phoneView === "list"} snap={snap} onSnap={setSnap}>
              <main
                id="main"
                tabIndex={-1}
                aria-label={t("plan")}
                className="min-h-0 min-w-0 overflow-y-auto pb-24 outline-none max-lg:flex-1 lg:border-r lg:border-line"
              >
                <Tabs
                  id={tabsId}
                  tab={tab}
                  onTab={setTab}
                  labels={{
                    plan: t("plan"),
                    checklist: (
                      <>
                        {t("checklist")}
                        {view.checklist.length > 0 && (
                          <span className="rounded-md bg-line-2 px-1.5 font-mono text-[11.5px]">
                            {done}/{view.checklist.length}
                          </span>
                        )}
                      </>
                    ),
                  }}
                />
                <div role="tabpanel" id={`${tabsId}-plan`} aria-labelledby={`${tabsId}-plan-tab`} hidden={tab !== "plan"}>
                  {editor !== null && (
                    <AddPlace
                      lists={lists}
                      full={full}
                      near={centre}
                      onAdd={(place, dayId) => addPlace(doc, { ...place, dayId }, editor)}
                      onSuggest={(place) => addPlace(doc, { ...place, dayId: null, status: "suggested" }, editor)}
                    />
                  )}
                  <Filters view={view} filter={filter} hidden={hiddenIds.size} onChange={setFilter} />
                  <Itinerary
                    view={view}
                    visible={visible}
                    travel={travel}
                    warnings={warnings}
                    weather={weather}
                    listLabel={(list) => labelIn(view, list)}
                    dayDate={dayDate}
                    selectedId={selectedPlaceId}
                    onSelect={select}
                    actions={actions}
                    userId={editor}
                  />
                </div>
                <div role="tabpanel" id={`${tabsId}-checklist`} aria-labelledby={`${tabsId}-checklist-tab`} hidden={tab !== "checklist"}>
                  <Checklist items={view.checklist} members={view.members} full={isChecklistFull(view)} actions={checklistActions} />
                </div>
              </main>
            </BottomSheet>
            <section aria-label={t("map")} className={`relative min-h-0 max-lg:absolute max-lg:inset-0 ${phoneView === "list" ? "max-lg:hidden" : ""}`}>
              <TripMap
                view={view}
                hiddenIds={hiddenIds}
                selectedDayId={selectedDayId}
                selectedPlaceId={selectedPlaceId}
                onSelectDay={setPickedDay}
                onSelectPlace={selectPin}
                routeGeometry={routeGeometry}
                awareness={awareness}
                userId={userId}
                add={
                  editor === null || full
                    ? null
                    : { lists, reverseGeocode, onAdd: ({ name, category, dayId, lat, lng }) => select(addPlace(doc, { name, category, dayId, lat, lng }, editor)) }
                }
                sheet={phoneView === "map" ? snap : null}
              />
              {status.kind === "offline" && (
                <p className="pointer-events-none absolute left-3 top-14 z-[3] rounded-lg border border-warn-line bg-warn-bg px-2.5 py-1 text-[12.5px] text-warn-ink shadow-1">
                  {tm("incompleteOffline")}
                </p>
              )}
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
                requestAnimationFrame(() => document.getElementById(toast.focus)?.focus());
              }}
            />
          )}
          <Announcer doc={doc} userId={userId} awareness={awareness} listLabel={labelIn} />
        </div>
      </SideBySide>
    </CollabContext.Provider>
  );
}

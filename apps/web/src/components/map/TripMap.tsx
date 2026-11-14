"use client";

import { useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { Awareness } from "y-protocols/awareness";
import type { TripView } from "@rota/trip";
import { setMapCursor, stopMapCursor } from "@/client/presence";
import { Icon } from "../trip/icons";
import type { ListChoice } from "../trip/MoveDialog";
import { AddHere, type NewMapPlace, type ReverseGeocode } from "./AddHere";
import { PEEK_PX, type Snap } from "./BottomSheet";
import { MapLoaderContext, type LngLat, type MapView, type Padding } from "./engine";
import { dayColour, mapFeatures, type Pin } from "./mapFeatures";
import { RemoteCursors } from "./RemoteCursors";

/** How long a touch must rest on the map to add a place there. */
export const LONG_PRESS_MS = 500;
/** A touch that moves more than this (px) is a pan, not a long-press. */
const LONG_PRESS_SLOP = 10;

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wide = () => typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 1024px)").matches;

type Props = {
  view: TripView;
  /** Places the filters hide: not pinned. */
  hiddenIds: Set<string>;
  /** The day whose route is drawn and whose pins the map fits; null for all days. */
  selectedDayId: string | null;
  selectedPlaceId: string | null;
  onSelectDay(id: string | null): void;
  onSelectPlace(id: string): void;
  /** Road geometry per day, when known; else routes are straight lines. */
  routeGeometry?: Record<string, GeoJSON.LineString>;
  awareness: Awareness | null;
  userId: string | null;
  /** Adding a place by right-click or long-press; null while editing is off or the trip is full. */
  add: {
    lists: ListChoice[];
    reverseGeocode?: ReverseGeocode;
    onAdd(place: NewMapPlace): void;
  } | null;
  /** How far the phone's list sheet is pulled up over the map; null when it is not over the map. */
  sheet: Snap | null;
};

/**
 * The trip's map (spec §6): MapLibre with OpenFreeMap tiles, pins per day in the day's colour, the
 * selected day's route, friends' cursors. Fits the trip when it opens and the selected day when that
 * changes; a pin selects its place in the list and a place selected in the list is brought into view.
 * Visual only: the list is the accessible source of truth, so pins are hidden from assistive technology.
 */
export function TripMap({ view, hiddenIds, selectedDayId, selectedPlaceId, onSelectDay, onSelectPlace, routeGeometry, awareness, userId, add, sheet }: Props) {
  const t = useTranslations("trip");
  const tm = useTranslations("map");
  const load = useContext(MapLoaderContext);
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [adding, setAdding] = useState<LngLat | null>(null);
  const features = useMemo(() => mapFeatures(view, { selectedDayId, hiddenIds, routeGeometry }), [view, selectedDayId, hiddenIds, routeGeometry]);

  // Room for the controls, and for the sheet where it covers the bottom of the map.
  const padding = (height: number): Padding => {
    const covered = wide() || sheet === null || sheet === "full" ? 0 : sheet === "half" ? height / 2 : PEEK_PX;
    return { top: 64, right: 56, bottom: 32 + covered, left: 32 };
  };

  const start = useEffectEvent(() => ({
    bounds: features.bounds,
    labels: {
      zoomIn: tm("zoomIn"),
      zoomOut: tm("zoomOut"),
      attribution: tm("attribution"),
    },
  }));
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let live = true;
    let made: MapView | null = null;
    load(el, start()).then(
      (m) => {
        if (!live) return m?.remove();
        made = m;
        if (m) setMap(m);
        else setUnavailable(true);
      },
      () => live && setUnavailable(true),
    );
    return () => {
      live = false;
      made?.remove();
      setMap(null);
    };
  }, [load]);

  useEffect(() => map?.setRoute(features.route), [map, features.route]);

  // Fit the trip once the map is there (its container has its final size by then), and the selected
  // day when it changes; otherwise bring a newly selected place into view if it is not.
  const fitted = useRef<{ map: MapView; day: string | null } | null>(null);
  const follow = useEffectEvent((m: MapView) => {
    const options = {
      padding: padding(m.size().height),
      animate: !reducedMotion(),
    };
    if (fitted.current?.map !== m) {
      fitted.current = { map: m, day: selectedDayId };
      m.fit(features.bounds, { ...options, animate: false });
    } else if (fitted.current.day !== selectedDayId) {
      fitted.current.day = selectedDayId;
      m.fit(features.bounds, options);
    } else {
      const pin = features.pins.find((p) => p.id === selectedPlaceId);
      if (!pin) return;
      const { x, y } = m.project(pin);
      const { width, height } = m.size();
      const p = options.padding;
      if (x < p.left || y < p.top || x > width - p.right || y > height - p.bottom) m.centre(pin, options);
    }
  });
  useEffect(() => {
    if (map) follow(map);
  }, [map, selectedDayId, selectedPlaceId]);

  // This person's pointer, for friends' maps (mouse and pen; a finger on the map is panning).
  useEffect(() => {
    if (!awareness) return;
    return () => stopMapCursor(awareness);
  }, [awareness]);

  // Right-click (desktop) or a 500 ms long-press (touch) on the map itself, not on a pin or control.
  const press = useRef<{
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);
  const local = (e: { clientX: number; clientY: number }) => {
    const rect = container.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onSurface = (target: EventTarget) =>
    target instanceof Element && !!container.current?.contains(target) && !target.closest("[data-pin], .maplibregl-ctrl");
  const lastPointer = useRef("mouse");

  function onPointerDown(e: ReactPointerEvent) {
    lastPointer.current = e.pointerType;
    cancelPress();
    if (!map || !add || e.pointerType !== "touch" || !e.isPrimary || !onSurface(e.target)) return;
    const at = map.unproject(local(e));
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => ((press.current = null), setAdding(at)), LONG_PRESS_MS),
    };
  }
  function onPointerMove(e: ReactPointerEvent) {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > LONG_PRESS_SLOP) cancelPress();
    if (map && awareness && userId && e.pointerType !== "touch") setMapCursor(awareness, round(map.unproject(local(e))));
  }

  const selectedDay = view.days.find((d) => d.id === selectedDayId);
  return (
    <div
      className="relative h-full min-h-0 w-full overflow-hidden bg-[#f1efe9]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={() => {
        cancelPress();
        if (awareness && userId) setMapCursor(awareness, null);
      }}
      onContextMenu={(e) => {
        // On touch screens the long-press handles it (and some browsers send this too).
        if (!map || !add || !onSurface(e.target)) return;
        e.preventDefault();
        if (lastPointer.current !== "touch") setAdding(map.unproject(local(e)));
      }}
    >
      {/* Sized as well as placed: maplibre-gl.css makes the map container `position: relative`. */}
      <div ref={container} className="absolute inset-0 h-full w-full" />
      {map && features.pins.map((pin) => <PinMarker key={pin.id} map={map} pin={pin} selected={pin.id === selectedPlaceId} onSelect={onSelectPlace} />)}
      {map && <RemoteCursors map={map} awareness={awareness} userId={userId} />}
      {unavailable && <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-[13.5px] text-ink-2">{tm("unavailable")}</p>}

      {view.days.length > 0 && (
        <div role="group" aria-label={tm("daysShown")} className="absolute left-3 right-16 top-3 z-[3] flex gap-1.5 overflow-x-auto p-0.5">
          {[null, ...view.days.map((d) => d.id)].map((id, i) => (
            <button
              key={id ?? ""}
              type="button"
              aria-pressed={selectedDayId === id}
              onClick={() => onSelectDay(id)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 text-[12.5px] font-medium text-ink-2 shadow-2 aria-pressed:bg-ink aria-pressed:text-white"
            >
              {id !== null && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: dayColour(i - 1) }} />}
              {id === null ? tm("allDays") : t("day", { n: i })}
            </button>
          ))}
        </div>
      )}
      {map && (
        <button
          type="button"
          aria-label={tm("fit")}
          title={tm("fit")}
          className="absolute right-2.5 top-[86px] z-[3] grid size-[29px] place-items-center rounded-[4px] bg-surface text-ink-2 shadow-[0_0_0_2px_rgba(0,0,0,.1)] hover:bg-hover"
          onClick={() =>
            map.fit(features.bounds, {
              padding: padding(map.size().height),
              animate: !reducedMotion(),
            })
          }
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      )}

      {adding && add && (
        <AddHere
          at={adding}
          lists={add.lists}
          defaultList={selectedDay?.id ?? null}
          reverseGeocode={add.reverseGeocode}
          onClose={() => setAdding(null)}
          onAdd={(place) => {
            add.onAdd(place);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

const round = ({ lat, lng }: LngLat): LngLat => ({
  lat: Math.round(lat * 1e6) / 1e6,
  lng: Math.round(lng * 1e6) / 1e6,
});

/** One pin: a numbered dot in its day's colour, or a grey dot with the category's icon for Ideas. */
function PinMarker({ map, pin, selected, onSelect }: { map: MapView; pin: Pin; selected: boolean; onSelect(id: string): void }) {
  const [element] = useState(() => document.createElement("div"));
  const marker = useRef<ReturnType<MapView["addMarker"]> | null>(null);
  const at = useEffectEvent(() => ({ lat: pin.lat, lng: pin.lng }));
  useEffect(() => {
    const m = map.addMarker(at(), element);
    marker.current = m;
    return () => {
      m.remove();
      marker.current = null;
    };
  }, [map, element]);
  useEffect(() => marker.current?.move({ lat: pin.lat, lng: pin.lng }), [pin.lat, pin.lng]);
  // The selected pin above the rest, the selected day's above the others'.
  const layer = selected ? "3" : pin.active ? "2" : "1";
  useEffect(() => {
    element.style.setProperty("z-index", layer);
  }, [element, layer]);

  const size = selected ? "size-8 text-[13px]" : "size-[26px] text-[11.5px]";
  return createPortal(
    <div
      data-pin={pin.id}
      aria-hidden="true"
      title={pin.name}
      onClick={() => onSelect(pin.id)}
      className={`grid cursor-pointer place-items-center rounded-full border-2 border-white font-mono font-semibold text-white shadow-[0_2px_6px_rgba(28,27,25,.3)] ${size} ${
        selected ? "outline-2 outline-offset-1 outline-ink" : ""
      } ${pin.active ? "" : "opacity-45"}`}
      style={{ background: pin.colour }}
    >
      {pin.number ?? <Icon name={pin.category} size={14} />}
    </div>,
    element,
  );
}

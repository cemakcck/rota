"use client";

import { useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { Awareness } from "y-protocols/awareness";
import type { TripView } from "@rota/trip";
import { setMapCursor, stopMapCursor } from "@/client/presence";
import type { ListChoice } from "../trip/MoveDialog";
import { AddHere, type NewMapPlace, type ReverseGeocode } from "./AddHere";
import { PEEK_PX, type Snap } from "./BottomSheet";
import { MapLoaderContext, type LngLat, type MapView, type Padding } from "./engine";
import { mapFeatures, type MapShown, type Pin } from "./mapFeatures";

export type { MapShown };
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
  /** What the map follows (the list column's view): a day, Ideas, or the whole trip. */
  shown: MapShown;
  selectedPlaceId: string | null;
  /** The details panel is open over the map's left edge (wide screens): fits keep the pins clear of it. */
  panel: boolean;
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

/** How much of the map's left edge the details panel covers on wide screens (its 16 px inset and 340 px width). */
export const PANEL_COVER_PX = 16 + 340;

/**
 * The trip's map (spec §2): MapLibre with OpenFreeMap's muted Positron style, following the view the
 * rail chose: a day's numbered teardrop pins and route in its colour, Ideas' small grey pins, or the
 * whole trip; friends' cursors. Fits what is shown when it opens and whenever the view changes (at once
 * under reduced motion); a pin selects its place and opens its details, and a place selected in the
 * list is brought into view. No controls on its left edge, where the details panel opens.
 * Visual only: the list is the accessible source of truth, so pins are hidden from assistive technology.
 */
export function TripMap({ view, hiddenIds, shown, selectedPlaceId, panel, onSelectPlace, routeGeometry, awareness, userId, add, sheet }: Props) {
  const tm = useTranslations("map");
  const load = useContext(MapLoaderContext);
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [adding, setAdding] = useState<LngLat | null>(null);
  const shownDayId = shown.kind === "day" ? shown.dayId : null;
  const shownKey = shown.kind === "day" ? `day:${shown.dayId}` : shown.kind;
  const features = useMemo(
    () => mapFeatures(view, { shown: shownDayId !== null ? { kind: "day", dayId: shownDayId } : { kind: shownKey as "ideas" | "all" }, hiddenIds, routeGeometry }),
    [view, shownKey, shownDayId, hiddenIds, routeGeometry],
  );

  // Room for the controls, for the details panel over the left edge (wide screens), and for the sheet
  // where it covers the bottom of the map (phones).
  const padding = (height: number): Padding => {
    const isWide = wide();
    const covered = isWide || sheet === null || sheet === "full" ? 0 : sheet === "half" ? height / 2 : PEEK_PX;
    return { top: 48, right: 56, bottom: 32 + covered, left: 32 + (isWide && panel ? PANEL_COVER_PX : 0) };
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

  useEffect(() => map?.setRoutes(features.routes), [map, features.routes]);

  // Fit what is shown once the map is there (its container has its final size by then), and again when
  // the view changes; otherwise bring a newly selected place into view if it is not.
  const fitted = useRef<{ map: MapView; view: string } | null>(null);
  const follow = useEffectEvent((m: MapView) => {
    const options = {
      padding: padding(m.size().height),
      animate: !reducedMotion(),
    };
    if (fitted.current?.map !== m) {
      fitted.current = { map: m, view: shownKey };
      m.fit(features.bounds, { ...options, animate: false });
    } else if (fitted.current.view !== shownKey) {
      fitted.current.view = shownKey;
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
  }, [map, shownKey, selectedPlaceId]);

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
          defaultList={view.days.some((d) => d.id === shownDayId) ? shownDayId : null}
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

/** "#1e3a8a" as rgba with the given alpha (a pin's halo). */
const tint = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/**
 * One pin: a teardrop in its day's colour with the stop number (about 34 px; 42 px with a halo when
 * selected), or a small grey one for Ideas. Hovering shows a small card with the place's name.
 */
function PinMarker({ map, pin, selected, onSelect }: { map: MapView; pin: Pin; selected: boolean; onSelect(id: string): void }) {
  const t = useTranslations("trip");
  const [element] = useState(() => document.createElement("div"));
  const [hover, setHover] = useState(false);
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
  // The selected (or hovered) pin above the rest, Ideas under the days' pins.
  const layer = selected || hover ? "3" : pin.number === null ? "1" : "2";
  useEffect(() => {
    element.style.setProperty("z-index", layer);
  }, [element, layer]);

  const idea = pin.number === null;
  const px = idea ? (selected ? 32 : 24) : selected ? 42 : 34;
  const size = idea ? (selected ? "size-8" : "size-6") : selected ? "size-[42px]" : "size-[34px]";
  const shadow = "0 3px 8px rgba(0, 0, 0, 0.25)";
  return createPortal(
    <div
      data-pin={pin.id}
      data-selected={selected || undefined}
      data-idea={idea || undefined}
      aria-hidden="true"
      onClick={() => onSelect(pin.id)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      className="relative flex cursor-pointer flex-col items-center"
    >
      {hover && (
        <span className="pointer-events-none absolute bottom-full mb-2 max-w-[220px] truncate whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1 text-[12.5px] font-semibold text-ink shadow-2">
          {pin.name || t("unnamed")}
        </span>
      )}
      {/* A square with three round corners, turned so the sharp one points at the place. */}
      <div
        data-pin-head
        className={`grid -rotate-45 place-items-center rounded-[50%_50%_50%_4px] border-[3px] border-white ${size}`}
        style={{
          background: pin.colour,
          boxShadow: selected ? `0 0 0 5px ${tint(pin.colour, 0.25)}, ${shadow}` : shadow,
          // The turned tip reaches below the square's box: this puts it on the coordinate.
          marginBottom: Math.round(px * 0.21),
        }}
      >
        {!idea && <span className={`rotate-45 font-semibold text-white ${selected ? "text-[15px]" : "text-[13px]"}`}>{pin.number}</span>}
      </div>
    </div>,
    element,
  );
}

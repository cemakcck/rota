"use client";

import { createContext } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Bounds, Route } from "./mapFeatures";

/**
 * The map engine behind a thin seam: TripMap and RemoteCursors talk to a `MapView`, never to MapLibre,
 * so they run in tests (jsdom has no WebGL) against a fake. `loadMapLibre` is the real one.
 */
export type LngLat = { lng: number; lat: number };
export type ScreenPoint = { x: number; y: number };
export type Padding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type MapMarker = { move(at: LngLat): void; remove(): void };
/** Where the view is: its centre and zoom. */
export type Camera = { centre: LngLat; zoom: number };

export type MapView = {
  /** Container pixels of a coordinate, and back. */
  project(at: LngLat): ScreenPoint;
  unproject(point: ScreenPoint): LngLat;
  size(): { width: number; height: number };
  /** The current zoom level (pin labels show only from street level). */
  zoom(): number;
  fit(bounds: Bounds, options: { padding: Padding; animate: boolean }): void;
  /** Brings a coordinate to the middle of the (padded) view. */
  centre(at: LngLat, options: { padding: Padding; animate: boolean }): void;
  /** The current camera, and a way back to one. */
  camera(): Camera;
  goTo(camera: Camera, options: { animate: boolean }): void;
  /** The routes drawn: the day's, or every day's for the whole trip. */
  setRoutes(routes: Route[]): void;
  /** Places an element (a pin) on the map, its bottom centre (the pin's tip) on the coordinate. */
  addMarker(at: LngLat, element: HTMLElement): MapMarker;
  /** Called on every frame the view moves or resizes. Returns the unsubscribe. */
  onMove(listener: () => void): () => void;
  /** Called when the person starts moving the view (drag, wheel, keys, pinch), not when code moves it. */
  onUserMove(listener: () => void): () => void;
  remove(): void;
};

export type MapLabels = {
  zoomIn: string;
  zoomOut: string;
  attribution: string;
  /** The canvas's own name (it is a region). */
  canvas: string;
};

/** Creates the map in `container` around `bounds`, resolving once it has started; null where it cannot run (no WebGL 2). */
export type LoadMap = (container: HTMLElement, options: { bounds: Bounds; labels: MapLabels }) => Promise<MapView | null>;

/** A muted basemap, so the day-coloured pins and routes stand out. */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
/** Closest zoom when fitting a few nearby pins (street level, not a single building). */
const MAX_FIT_ZOOM = 16;

/** The MapLibre implementation: OpenFreeMap's Positron style, OSM attribution always shown, no rotation. */
export const loadMapLibre: LoadMap = async (container, { bounds, labels }) => {
  if (typeof window === "undefined" || typeof window.WebGL2RenderingContext === "undefined") return null;
  const maplibre = await import("maplibre-gl");
  // Bundled, MapLibre cannot find its worker next to itself: it is served from this origin instead.
  maplibre.setWorkerUrl(new URL(`/maplibre-gl-worker.mjs?v=${maplibre.getVersion()}`, window.location.origin).href);
  let map: import("maplibre-gl").Map;
  try {
    map = new maplibre.Map({
      container,
      style: MAP_STYLE,
      // Roughly there; the caller fits the bounds (with padding) as soon as the map exists. (Passing
      // `bounds` here would be applied after that fit, without the padding.)
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      zoom: 12,
      // Expanded (not the compact "i" button), so "© OpenStreetMap" stays visible.
      attributionControl: { compact: false },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      locale: {
        "NavigationControl.ZoomIn": labels.zoomIn,
        "NavigationControl.ZoomOut": labels.zoomOut,
        "AttributionControl.ToggleAttribution": labels.attribution,
        // The canvas is a region of its own: named apart from the "Map" section around it.
        "Map.Title": labels.canvas,
      },
    });
  } catch {
    return null;
  }
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");

  // Routes: a white casing under the day-coloured line (about 6 px), dotted when it is a straight-line estimate.
  let routes: Route[] = [];
  const data = (): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: routes.map((route) => ({
      type: "Feature",
      geometry: route.line,
      properties: {
        colour: route.colour,
        approximate: route.approximate,
      },
    })),
  });
  const draw = () => {
    const source = map.getSource("route");
    if (source && "setData" in source) (source as import("maplibre-gl").GeoJSONSource).setData(data());
  };
  // Ready once the style has loaded (or failed to): camera moves made earlier are overridden as the
  // map starts.
  const ready = new Promise<void>((resolve) => {
    map.once("load", () => resolve());
    map.once("error", () => resolve());
  });
  map.on("load", () => {
    map.addSource("route", { type: "geojson", data: data() });
    const line = { "line-cap": "round", "line-join": "round" } as const;
    map.addLayer({
      id: "route-casing",
      type: "line",
      source: "route",
      layout: line,
      paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.9 },
    });
    map.addLayer({
      id: "route-road",
      type: "line",
      source: "route",
      filter: ["==", ["get", "approximate"], false],
      layout: line,
      paint: { "line-color": ["get", "colour"], "line-width": 6, "line-opacity": 0.9 },
    });
    map.addLayer({
      id: "route-approx",
      type: "line",
      source: "route",
      filter: ["==", ["get", "approximate"], true],
      layout: line,
      paint: {
        "line-color": ["get", "colour"],
        "line-width": 6,
        "line-dasharray": [0.2, 1.8],
      },
    });
  });

  await ready;
  return {
    project: (at) => map.project([at.lng, at.lat]),
    unproject: ({ x, y }) => map.unproject([x, y]),
    size: () => ({
      width: container.clientWidth,
      height: container.clientHeight,
    }),
    zoom: () => map.getZoom(),
    fit: (b, { padding: p, animate }) => void map.fitBounds(b, { padding: p, maxZoom: MAX_FIT_ZOOM, animate }),
    centre: (at, { padding: p, animate }) => void map.easeTo({ center: [at.lng, at.lat], padding: p, animate }),
    camera: () => {
      const { lng, lat } = map.getCenter();
      return { centre: { lng, lat }, zoom: map.getZoom() };
    },
    goTo: ({ centre, zoom }, { animate }) => void map.easeTo({ center: [centre.lng, centre.lat], zoom, animate }),
    setRoutes(next) {
      routes = next;
      draw();
    },
    addMarker(at, element) {
      const marker = new maplibre.Marker({ element, anchor: "bottom" }).setLngLat([at.lng, at.lat]).addTo(map);
      return {
        move: (to) => void marker.setLngLat([to.lng, to.lat]),
        remove: () => void marker.remove(),
      };
    },
    onMove(listener) {
      map.on("move", listener);
      map.on("resize", listener);
      return () => {
        map.off("move", listener);
        map.off("resize", listener);
      };
    },
    onUserMove(listener) {
      // Moves started by code carry no originalEvent.
      const onStart = (e: { originalEvent?: unknown }) => e.originalEvent && listener();
      map.on("movestart", onStart);
      return () => void map.off("movestart", onStart);
    },
    remove: () => map.remove(),
  };
};

/** Which engine the map uses: MapLibre, or a fake in tests. */
export const MapLoaderContext = createContext<LoadMap>(loadMapLibre);

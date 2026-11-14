import type { Bounds, Route } from "@/components/map/mapFeatures";
import type { LngLat, LoadMap, MapView, Padding } from "@/components/map/engine";

/**
 * A stand-in for MapLibre (jsdom has no WebGL): a flat 800 (or `width`) × 600 view where 1° is 100 px (or
 * `scale`), with the top-left corner at (lng 28, lat 42). Markers are put into the container, so pins can be
 * queried. Its zoom is 7 (about 100 px a degree, too far out for pin labels) unless given.
 */
export function fakeMap({ width = 800, zoom = 7, scale = 100 }: { width?: number; zoom?: number; scale?: number } = {}) {
  const state = {
    container: null as HTMLElement | null,
    start: null as { bounds: Bounds } | null,
    routes: [] as Route[],
    fits: [] as Bounds[],
    /** How each fit was asked for (padding, animated or not), in step with `fits`. */
    fitOptions: [] as { padding: Padding; animate: boolean }[],
    centred: [] as LngLat[],
    /** Cameras gone back to (goTo), in order. */
    returned: [] as { centre: LngLat; zoom: number }[],
    userListeners: new Set<() => void>(),
    removed: false,
    origin: { lng: 28, lat: 42 },
    zoom,
    listeners: new Set<() => void>(),
  };
  const view: MapView = {
    project: ({ lng, lat }) => ({
      x: (lng - state.origin.lng) * scale,
      y: (state.origin.lat - lat) * scale,
    }),
    unproject: ({ x, y }) => ({
      lng: state.origin.lng + x / scale,
      lat: state.origin.lat - y / scale,
    }),
    zoom: () => state.zoom,
    size: () => ({ width, height: 600 }),
    fit: (bounds, options) => {
      state.fits.push(bounds);
      state.fitOptions.push(options);
    },
    centre: (at) => void state.centred.push(at),
    camera: () => ({ centre: { ...state.origin }, zoom: state.zoom }),
    goTo: (camera) => {
      state.returned.push(camera);
      state.origin = { ...camera.centre };
      state.zoom = camera.zoom;
    },
    setRoutes: (routes) => void (state.routes = routes),
    addMarker(_at, element) {
      state.container!.appendChild(element);
      return { move: () => undefined, remove: () => element.remove() };
    },
    onMove(listener) {
      state.listeners.add(listener);
      return () => void state.listeners.delete(listener);
    },
    onUserMove(listener) {
      state.userListeners.add(listener);
      return () => void state.userListeners.delete(listener);
    },
    remove: () => void (state.removed = true),
  };
  const load: LoadMap = async (container, { bounds }) => {
    state.container = container;
    state.start = { bounds };
    return view;
  };
  /** Pans the view (as a drag would) and tells listeners, like MapLibre's move event. */
  const pan = (to: LngLat) => {
    state.origin = to;
    state.listeners.forEach((l) => l());
  };
  /** Zooms (as the wheel would) and tells listeners. */
  const zoomTo = (to: number) => {
    state.zoom = to;
    state.listeners.forEach((l) => l());
  };
  /** The person drags the view (a user move, then the move itself). */
  const drag = (to: LngLat) => {
    state.userListeners.forEach((l) => l());
    pan(to);
  };
  return { state, load, pan, zoomTo, drag };
}

import type { Bounds, Route } from "@/components/map/mapFeatures";
import type { LngLat, LoadMap, MapView, Padding } from "@/components/map/engine";

/**
 * A stand-in for MapLibre (jsdom has no WebGL): a flat 800 × 600 view where 1° is 100 px, with the
 * top-left corner at (lng 28, lat 42). Markers are put into the container, so pins can be queried.
 */
export function fakeMap() {
  const state = {
    container: null as HTMLElement | null,
    start: null as { bounds: Bounds } | null,
    routes: [] as Route[],
    fits: [] as Bounds[],
    /** How each fit was asked for (padding, animated or not), in step with `fits`. */
    fitOptions: [] as { padding: Padding; animate: boolean }[],
    centred: [] as LngLat[],
    removed: false,
    origin: { lng: 28, lat: 42 },
    listeners: new Set<() => void>(),
  };
  const view: MapView = {
    project: ({ lng, lat }) => ({
      x: (lng - state.origin.lng) * 100,
      y: (state.origin.lat - lat) * 100,
    }),
    unproject: ({ x, y }) => ({
      lng: state.origin.lng + x / 100,
      lat: state.origin.lat - y / 100,
    }),
    size: () => ({ width: 800, height: 600 }),
    fit: (bounds, options) => {
      state.fits.push(bounds);
      state.fitOptions.push(options);
    },
    centre: (at) => void state.centred.push(at),
    setRoutes: (routes) => void (state.routes = routes),
    addMarker(_at, element) {
      state.container!.appendChild(element);
      return { move: () => undefined, remove: () => element.remove() };
    },
    onMove(listener) {
      state.listeners.add(listener);
      return () => void state.listeners.delete(listener);
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
  return { state, load, pan };
}

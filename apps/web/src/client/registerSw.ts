"use client";

import { useEffect } from "react";

/** The app's own files that the worker keeps (as in sw.js): built chunks, MapLibre's worker, icons. */
const isStatic = (url: URL) =>
  url.origin === location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname === "/maplibre-gl-worker.mjs" || url.pathname.startsWith("/icons/"));

/**
 * Registers the service worker (src/sw/sw.js, spec §10) in production builds only: in development it
 * would serve stale pages and code. Scope "/" covers /en and /tr.
 *
 * This page and what it loaded so far did not go through the worker if it was not in charge yet (the
 * first visit), so once it is active the page asks it to keep them: the page then opens offline.
 */
export function registerSw(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => console.error("[sw] registration failed", error));
  navigator.serviceWorker.ready
    .then((registration) => {
      const loaded = performance.getEntriesByType("resource").map((entry) => entry.name);
      const urls = [location.href, ...loaded.filter((name) => isStatic(new URL(name)))];
      registration.active?.postMessage({ type: "keep", urls });
    })
    .catch(() => undefined);
}

/** Mounted once in the layout. */
export function RegisterSw(): null {
  useEffect(registerSw, []);
  return null;
}

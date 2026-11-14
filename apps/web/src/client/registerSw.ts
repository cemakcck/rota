"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** The app's own files that the worker keeps (as in sw.js): built chunks, MapLibre's worker, icons. */
const isStatic = (url: URL) =>
  url.origin === location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname === "/maplibre-gl-worker.mjs" || url.pathname.startsWith("/icons/"));

const enabled = () => process.env.NODE_ENV === "production" && "serviceWorker" in navigator;

/**
 * Registers the service worker (src/sw/sw.js, spec §10) in production builds only: in development it
 * would serve stale pages and code. Scope "/" covers /en and /tr.
 */
export function registerSw(): void {
  if (!enabled()) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => console.error("[sw] registration failed", error));
}

/**
 * Asks the worker, once it is active, to keep this page and the app's static files loaded so far. A page
 * reached by an in-app navigation (a link in My trips) never reaches the worker as a page load, and on
 * the first visit nothing went through it, so without this such a page would not open offline.
 */
export function keepThisPage(): void {
  if (!enabled()) return;
  navigator.serviceWorker.ready
    .then((registration) => {
      const loaded = performance.getEntriesByType("resource").map((entry) => entry.name);
      const urls = [location.href, ...loaded.filter((name) => isStatic(new URL(name)))];
      registration.active?.postMessage({ type: "keep", urls });
    })
    .catch(() => undefined);
}

/** Mounted once in the layout: registers the worker, and asks it to keep each page this tab shows. */
export function RegisterSw(): null {
  const pathname = usePathname();
  useEffect(registerSw, []);
  useEffect(keepThisPage, [pathname]);
  return null;
}

"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js, spec §10) in production builds only: in development it
 * would serve stale pages and code. Scope "/" covers /en and /tr.
 */
export function registerSw(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => console.error("[sw] registration failed", error));
}

/** Mounted once in the layout. */
export function RegisterSw(): null {
  useEffect(registerSw, []);
  return null;
}

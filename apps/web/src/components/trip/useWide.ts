"use client";

import { useSyncExternalStore } from "react";

/** The desktop layout's breakpoint (Tailwind's `lg`): rail · list · map from here, the phone layout below. */
export const WIDE_QUERY = "(min-width: 1024px)";

/** Whether a media query matches, following changes; `fallback` on the server and without matchMedia. */
export function useMedia(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener?.("change", onChange);
      return () => list?.removeEventListener?.("change", onChange);
    },
    () => window.matchMedia?.(query).matches ?? fallback,
    () => fallback,
  );
}

/** Whether the window is wide enough for the desktop layout; follows resizes. Wide on the server and without matchMedia. */
export function useWide(): boolean {
  return useMedia(WIDE_QUERY, true);
}

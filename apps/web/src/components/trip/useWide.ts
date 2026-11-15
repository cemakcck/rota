"use client";

import { useSyncExternalStore } from "react";

/** The desktop layout's breakpoint (Tailwind's `lg`): rail · list · map from here, the phone layout below. */
export const WIDE_QUERY = "(min-width: 1024px)";

/** Whether the window is wide enough for the desktop layout; follows resizes. Wide on the server and without matchMedia. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia?.(WIDE_QUERY);
      query?.addEventListener?.("change", onChange);
      return () => query?.removeEventListener?.("change", onChange);
    },
    () => window.matchMedia?.(WIDE_QUERY).matches ?? true,
    () => true,
  );
}

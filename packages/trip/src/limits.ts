import type { TripView } from "./schema";

// Soft caps, enforced in the interface only: the server never refuses an update for size.
export const SOFT_MAX_BYTES = 2 * 1024 * 1024;
export const SOFT_MAX_PLACES = 200;
export const SOFT_MAX_CHECKLIST = 100;

export function isTripFull(view: TripView, docBytes: number): boolean {
  return view.placeCount >= SOFT_MAX_PLACES || docBytes >= SOFT_MAX_BYTES;
}

export function isChecklistFull(view: TripView): boolean {
  return view.checklist.length >= SOFT_MAX_CHECKLIST;
}

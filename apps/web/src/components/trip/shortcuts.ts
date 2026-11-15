"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { Undo } from "@rota/trip";
import type { TripViewState } from "./view";

/** Input types that take no typing: a key on them is a shortcut. */
const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "file", "color", "range"]);

/** True while focus is in something that takes text (or a select's letters): the key is typing, not a shortcut. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NOT_TEXT.has(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target.isContentEditable || target.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
}

/**
 * True when a key is not for the trip: typing in a field or an open note (its own undo wins), or while
 * a dialog (settings, Move to…, the phone's details sheet, the tour, this sheet) is open, where it would
 * change the trip unseen.
 */
function notForTrip(target: EventTarget | null): boolean {
  if (typing(target)) return true;
  // An open note (its toolbar too): the note's own undo, or nothing.
  if (target instanceof Element && target.closest("[data-note-editor]")) return true;
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/** Another dialog than the details sheet is open: Escape is that dialog's. */
const otherDialog = () => document.querySelector('[role="dialog"]:not(#place-details), [role="alertdialog"]') !== null;

/**
 * The trip screen's keyboard shortcuts (spec §5), on top of each control's own keys (Alt+↑/↓ on a stop):
 * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo this person's edits; ? opens the shortcuts sheet; /
 * goes to the search; [ and ] show the previous and next day (as the rail and the chips do, in the
 * address too); Escape closes the details panel. None fire while typing in a field or while a dialog is
 * open, nor with Ctrl or Cmd held (the browser's keys); the single-key ones only while `characterKeys`.
 * Returns what a screen reader should hear after a day change.
 */
export function useTripShortcuts(o: {
  undo: Undo | null;
  characterKeys: boolean;
  days: readonly { id: string }[];
  shown: TripViewState;
  show(v: TripViewState): void;
  /** What is said when a day is shown. */
  dayLabel(dayId: string): string;
  onHelp(): void;
  /** Focuses the search; false when this view has none. */
  onSearch(): boolean;
  /** Closes the details panel; false when none is open. */
  onEscape(): boolean;
}): string {
  // What to say, and how often it was said: a repeat gets a no-break space, so the live region changes and speaks again.
  const [said, setSaid] = useState({ text: "", count: 0 });

  const stepDay = (by: -1 | 1) => {
    const { days, shown } = o;
    if (days.length === 0) return;
    const at = shown.kind === "day" ? days.findIndex((d) => d.id === shown.dayId) : -1;
    // From Ideas, the checklist or the whole trip: ] starts at the first day, [ at the last.
    const to = at < 0 ? (by > 0 ? 0 : days.length - 1) : Math.min(Math.max(at + by, 0), days.length - 1);
    if (to === at) return;
    const dayId = days[to].id;
    o.show({ kind: "day", dayId });
    const text = o.dayLabel(dayId);
    setSaid((was) => ({ text, count: was.count + 1 }));
    // Focus on something of the day left behind would fall to the page: it goes to the plan instead.
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) document.getElementById("main")?.focus();
    });
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && e.key.toLowerCase() === "z") {
      if (!o.undo || notForTrip(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) o.undo.redo();
      else o.undo.undo();
      return;
    }
    if (e.key === "Escape") {
      // Fields, popovers and dialogs handle their own Escape (and stop it) first.
      if (mod || e.altKey || typing(e.target) || otherDialog()) return;
      if (o.onEscape()) e.preventDefault();
      return;
    }
    // Ctrl or Cmd chords are the browser's (AltGr, Ctrl+Alt on Windows, still types [ and ] on some layouts).
    if (!o.characterKeys || e.metaKey || (e.ctrlKey && !e.altKey) || notForTrip(e.target)) return;
    if (e.key === "?") {
      e.preventDefault();
      o.onHelp();
    } else if (e.key === "/") {
      if (o.onSearch()) e.preventDefault();
    } else if (e.key === "[" || e.key === "]") {
      e.preventDefault();
      stepDay(e.key === "[" ? -1 : 1);
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return said.count % 2 === 0 ? said.text : `${said.text}\u00a0`;
}

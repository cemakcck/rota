"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { btn, btnSm } from "../ui";

/** How long the toast stays, counted only while the pointer and focus are elsewhere (WCAG 2.2.1). */
export const UNDO_TOAST_MS = 5000;

/** Whether the element shows keyboard focus (a programmatic focus after a click does not). */
function keyboardFocused(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * "Galata Tower deleted. Undo". Focus moves to Undo (the deleted row's buttons are gone), so keyboard
 * and screen reader users reach it at once. The timer pauses while it is hovered or keyboard-focused.
 */
export function UndoToast({ name, onUndo, onClose }: { name: string; onUndo: () => void; onClose: () => void }) {
  const t = useTranslations("trip");
  const button = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  useEffect(() => {
    button.current?.focus();
  }, []);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onClose, UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [paused, onClose]);

  return (
    <div
      className="fixed bottom-4 left-1/2 z-30 flex w-[calc(100%-32px)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-3"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => setFocused(keyboardFocused(e.target))}
      onBlur={() => setFocused(false)}
    >
      <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t("deleted", { name })}</p>
      <button ref={button} type="button" className={`${btn} ${btnSm} text-ink`} aria-label={t("undoDeleteFor", { name })} onClick={onUndo}>
        {t("undo")}
      </button>
    </div>
  );
}

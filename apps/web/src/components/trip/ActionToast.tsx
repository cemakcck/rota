"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { btn, btnSm } from "../ui";

/** How long a toast stays, counted only while the pointer and focus are elsewhere (WCAG 2.2.1). */
export const ACTION_TOAST_MS = 6000;

/** What a toast says ("Added to Day 1 at 16:00"), and its Undo (named for screen readers by `undoLabel`). */
export type ActionToastInput = {
  message: string;
  onUndo?: () => void;
  /** The Undo button's accessible name ("Undo adding Pera"); its visible text is "Undo". */
  undoLabel?: string;
  /** Move focus to Undo: when what was acted on (and its buttons) is gone, e.g. after a delete. */
  focus?: boolean;
  /** Where focus goes if the toast closes while holding it (the related row or day); else the screen's fallback. */
  returnFocus?: () => HTMLElement | null;
};

type Shown = ActionToastInput & { key: number };

type ToastApi = {
  /** Shows a toast, replacing any shown one (one at a time). */
  show(toast: ActionToastInput): void;
  dismiss(): void;
  current: Shown | null;
};

const ToastContext = createContext<ToastApi | null>(null);

/** The screen's toast: `show` from anywhere below; at most one at a time. */
export function useActionToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useActionToast needs an ActionToastProvider");
  return api;
}

/**
 * Holds the one action toast of a screen and draws it: its message in a polite live region (always
 * present, so the change is announced), Undo beside it. Gone after 6 s, paused while hovered or while
 * focus is anywhere in it (however it got there); Escape closes it. Closing while it holds focus sends
 * focus to the toast's `returnFocus`, else to `fallbackFocus` (the screen's search), never to the page.
 */
export function ActionToastProvider({ children, fallbackFocus }: { children: ReactNode; fallbackFocus?: () => HTMLElement | null }) {
  const [current, setCurrent] = useState<Shown | null>(null);
  const counter = useRef(0);
  const show = useCallback((toast: ActionToastInput) => setCurrent({ ...toast, key: ++counter.current }), []);
  const dismiss = useCallback(() => setCurrent(null), []);
  const api = useMemo(() => ({ show, dismiss, current }), [show, dismiss, current]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastView toast={current} onClose={dismiss} fallbackFocus={fallbackFocus} />
    </ToastContext.Provider>
  );
}

/** The live region stays mounted across toasts, so each new message is announced. */
function ToastView({ toast, onClose, fallbackFocus }: { toast: Shown | null; onClose: () => void; fallbackFocus?: () => HTMLElement | null }) {
  const t = useTranslations("trip");
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Whether focus is in the toast (kept through an unmount, which fires no blur), and the toast it is in.
  const holding = useRef(false);
  const last = useRef<Shown | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // A new toast (or none) starts unfocused: the last one's button may have gone while focused.
  const [seen, setSeen] = useState(toast?.key);
  if (seen !== toast?.key) {
    setSeen(toast?.key);
    setFocused(false);
  }
  const paused = hovered || focused;

  // The toast holding focus went (closed or replaced): focus goes somewhere useful, unless the next one takes it.
  useLayoutEffect(() => {
    const was = last.current;
    last.current = toast;
    if (!holding.current || was === toast) return;
    if (toast?.focus && toast.onUndo) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && !box.current?.contains(active)) return;
    holding.current = false;
    (was?.returnFocus?.() ?? fallbackFocus?.())?.focus();
  }, [toast, fallbackFocus]);
  useEffect(() => {
    if (toast?.focus) button.current?.focus();
  }, [toast]);
  useEffect(() => {
    if (!toast || paused) return;
    // Focus inside (even with no focus event, as when a reused Undo keeps it): not yet; leaving it restarts the 6 s.
    const timer = setTimeout(() => {
      if (box.current?.contains(document.activeElement)) setFocused(true);
      else onClose();
    }, ACTION_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, paused, onClose]);

  return (
    <div
      data-action-toast={toast ? "" : undefined}
      className={
        toast
          ? "fixed bottom-4 left-1/2 z-30 flex w-[calc(100%-32px)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-3"
          : "sr-only"
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      ref={box}
      onFocus={() => {
        holding.current = true;
        setFocused(true);
      }}
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        holding.current = false;
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !toast) return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div role="status" aria-live="polite" className="min-w-0 flex-1">
        {toast && <p className="[overflow-wrap:anywhere]">{toast.message}</p>}
      </div>
      {toast?.onUndo && (
        <button
          ref={button}
          type="button"
          className={`${btn} ${btnSm} text-ink`}
          aria-label={toast.undoLabel}
          onClick={() => {
            toast.onUndo?.();
            onClose();
          }}
        >
          {t("undo")}
        </button>
      )}
    </div>
  );
}

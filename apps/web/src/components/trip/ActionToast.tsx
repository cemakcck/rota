"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { btn, btnSm } from "../ui";

/** How long a toast stays, counted only while the pointer and keyboard focus are elsewhere (WCAG 2.2.1). */
export const ACTION_TOAST_MS = 6000;

/** What a toast says ("Added to Day 1 at 16:00"), and its Undo (named for screen readers by `undoLabel`). */
export type ActionToastInput = {
  message: string;
  onUndo?: () => void;
  /** The Undo button's accessible name ("Undo adding Pera"); its visible text is "Undo". */
  undoLabel?: string;
  /** Move focus to Undo: when what was acted on (and its buttons) is gone, e.g. after a delete. */
  focus?: boolean;
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

/** Whether the element shows keyboard focus (a programmatic focus after a click does not). */
function keyboardFocused(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * Holds the one action toast of a screen and draws it: its message in a polite live region (always
 * present, so the change is announced), Undo beside it. Gone after 6 s, paused while hovered or
 * keyboard-focused; Escape closes it.
 */
export function ActionToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Shown | null>(null);
  const counter = useRef(0);
  const show = useCallback((toast: ActionToastInput) => setCurrent({ ...toast, key: ++counter.current }), []);
  const dismiss = useCallback(() => setCurrent(null), []);
  const api = useMemo(() => ({ show, dismiss, current }), [show, dismiss, current]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastView toast={current} onClose={dismiss} />
    </ToastContext.Provider>
  );
}

/** The live region stays mounted across toasts, so each new message is announced. */
function ToastView({ toast, onClose }: { toast: Shown | null; onClose: () => void }) {
  const t = useTranslations("trip");
  const button = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // A new toast (or none) starts unfocused: the last one's button may have gone while focused.
  const [seen, setSeen] = useState(toast?.key);
  if (seen !== toast?.key) {
    setSeen(toast?.key);
    setFocused(false);
  }
  const paused = hovered || focused;

  useEffect(() => {
    if (toast?.focus) button.current?.focus();
  }, [toast]);
  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(onClose, ACTION_TOAST_MS);
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
      onFocus={(e) => setFocused(keyboardFocused(e.target))}
      onBlur={() => setFocused(false)}
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

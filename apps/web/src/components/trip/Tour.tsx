"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import type * as Y from "yjs";
import { isFriendWindow } from "@/client/friendHandoff";
import { markTipsSeen, tipsSeenHere, tipsSeenOnServer } from "@/client/tips";
import { btn, btnPrimary, btnSm } from "../ui";

/** The tour's steps (spec §4): what each says, and the element it points at (its `data-tour` attribute). */
const STEPS = ["days", "search", "share"] as const;
type Step = (typeof STEPS)[number];

const GAP = 12;
const EDGE = 16;
const CARD_WIDTH = 320;

/**
 * Whether the first-time tour is shown, and `finish` (Done, Skip or Escape) to remember it was seen.
 * Shown once per user (this device first, then the server) to someone who can edit the trip, once it
 * has loaded. In a friend window only after their first edit; offline with nothing known, not at all
 * (it waits for a time the server can say whether it was seen elsewhere).
 */
export function useTour(doc: Y.Doc, editor: string | null, ready: boolean): { open: boolean; finish(): void } {
  const [friend] = useState(isFriendWindow);
  const [editedBy, setEditedBy] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const edited = editor !== null && editedBy === editor;

  // A friend window waits for this person's first edit (a change of theirs, not one arriving).
  useEffect(() => {
    if (!friend || editor === null || edited) return;
    const onTransaction = (tr: Y.Transaction) => {
      if (tr.origin === editor && tr.changed.size > 0) setEditedBy(editor);
    };
    doc.on("afterTransaction", onTransaction);
    return () => doc.off("afterTransaction", onTransaction);
  }, [doc, friend, editor, edited]);

  const eligible = ready && editor !== null && (!friend || edited);
  useEffect(() => {
    if (!eligible || editor === null) return;
    const here = tipsSeenHere(editor);
    if (here === "pending") void markTipsSeen(editor);
    if (here !== null) return;
    let live = true;
    void tipsSeenOnServer(editor).then((seen) => {
      if (live && seen === false) setShownFor(editor);
    });
    return () => {
      live = false;
    };
  }, [eligible, editor]);

  return {
    open: eligible && shownFor !== null && shownFor === editor,
    finish() {
      if (editor !== null) void markTipsSeen(editor);
      setShownFor(null);
    },
  };
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The step's target, when it is on the page and has a size (hidden ones, such as a phone's other view, do not). */
function targetRect(step: Step): DOMRect | null {
  const el = document.querySelector(`[data-tour="${step}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/** Next to the target: below it, else beside it, else above it; always within the window. Centred without one. */
function place(rect: DOMRect | null, card: { width: number; height: number }): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, vw - card.width - EDGE));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, vh - card.height - EDGE));
  if (!rect) return { left: clampX((vw - card.width) / 2), top: clampY((vh - card.height) / 2) };
  if (rect.bottom + GAP + card.height <= vh - EDGE) return { left: clampX(rect.left), top: rect.bottom + GAP };
  if (rect.right + GAP + card.width <= vw - EDGE) return { left: rect.right + GAP, top: clampY(rect.top) };
  if (rect.left - GAP - card.width >= EDGE) return { left: rect.left - GAP - card.width, top: clampY(rect.top) };
  return { left: clampX(rect.left), top: clampY(rect.top - GAP - card.height) };
}

/**
 * The first-time tour (spec §4): three steps pointing at the rail, the search and Share. A modal dialog:
 * focus moves into it (on Next) and stays there, Escape or Skip tour ends it, and focus goes back to
 * where it was. The step's target is outlined and brought into view (instantly when motion is reduced).
 */
export function Tour({ onDone }: { onDone(): void }) {
  const t = useTranslations("tour");
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  // Where focus was when the tour opened: it goes back there after (to the plan if that is gone).
  const [returnTo] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const [layout, setLayout] = useState<{ rect: DOMRect | null; style: CSSProperties }>({ rect: null, style: { visibility: "hidden" } });

  useEffect(() => {
    document.querySelector(`[data-tour="${step}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [step]);

  // Placed for the step, and again whenever the page moves under it.
  useLayoutEffect(() => {
    const measure = () => {
      const rect = targetRect(step);
      const size = { width: card.current?.offsetWidth || CARD_WIDTH, height: card.current?.offsetHeight || 160 };
      setLayout({ rect, style: place(rect, size) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  const { rect } = layout;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDone()}>
      <Dialog.Portal>
        {/* Dims the screen, leaving the target lit and outlined. */}
        <Dialog.Overlay
          data-testid="tour-spotlight"
          className="fixed z-50 rounded-xl outline-2 outline-offset-2 outline-white motion-safe:transition-all motion-safe:duration-200"
          style={
            rect
              ? { left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: "0 0 0 9999px rgb(28 25 23 / 0.5)" }
              : { inset: 0, background: "rgb(28 25 23 / 0.5)", outline: "none" }
          }
        />
        <Dialog.Content
          ref={card}
          aria-modal="true"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            next.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            (returnTo?.isConnected ? returnTo : document.getElementById("main"))?.focus();
          }}
          // Only Escape, Skip or Done end it: a stray click on the dimmed screen does not.
          onInteractOutside={(e) => e.preventDefault()}
          style={{ ...layout.style, width: `min(${CARD_WIDTH}px, calc(100vw - ${EDGE * 2}px))` }}
          className="fixed z-50 grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-2 outline-none motion-safe:transition-[left,top] motion-safe:duration-200"
        >
          <Dialog.Title className="text-[16px] font-semibold leading-snug text-ink">{t(step)}</Dialog.Title>
          <Dialog.Description className="text-[12.5px] text-ink-2">{t("progress", { n: index + 1, total: STEPS.length })}</Dialog.Description>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`${btn} ${btnSm}`} onClick={onDone}>
              {t("skip")}
            </button>
            <div className="ml-auto flex gap-2">
              {index > 0 && (
                <button type="button" className={`${btn} ${btnSm}`} onClick={() => {
                    setIndex(index - 1);
                    // Back is gone on the first step: focus to the main button.
                    if (index === 1) next.current?.focus();
                  }}>
                  {t("back")}
                </button>
              )}
              <button
                ref={next}
                type="button"
                className={`${btnPrimary} ${btnSm}`}
                onClick={() => {
                  if (last) return onDone();
                  setIndex(index + 1);
                  // Focus stays on the main button as it changes from Next to Done.
                  next.current?.focus();
                }}
              >
                {last ? t("done") : t("next")}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

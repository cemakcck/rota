"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export type Snap = "peek" | "half" | "full";
const SNAPS: Snap[] = ["peek", "half", "full"];
/** How much of the list shows when the sheet is minimised. */
export const PEEK_PX = 96;
const HEIGHT: Record<Snap, string> = {
  peek: `${PEEK_PX}px`,
  half: "50%",
  full: "100%",
};

/**
 * On phones (below 1024 px), the list in a sheet over the full-screen map (spec §6): dragged by its
 * handle between three heights (peek, half, full), or stepped through them with the handle as a button
 * (Enter or Space cycles, arrow keys go up and down), each change announced. Focus moving into a
 * minimised list opens it to half. From 1024 px, and when `off` (the list-only view), it is a plain
 * column.
 */
export function BottomSheet({
  off = false,
  snap: controlled,
  onSnap,
  children,
}: {
  off?: boolean;
  /** Where the sheet is, when the caller keeps it (else it keeps its own, starting at half). */
  snap?: Snap;
  onSnap?: (snap: Snap) => void;
  children: ReactNode;
}) {
  const t = useTranslations("map");
  const [own, setOwn] = useState<Snap>("half");
  const snap = controlled ?? own;
  const [announced, setAnnounced] = useState("");
  // While dragging: the sheet's height in px; and whether the pointer moved (then it is not a click).
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{
    startY: number;
    startHeight: number;
    max: number;
    moved: boolean;
  } | null>(null);
  const dragged = useRef(false);
  const sheet = useRef<HTMLDivElement>(null);

  const go = (to: Snap) => {
    setOwn(to);
    onSnap?.(to);
    setAnnounced(t(`sheet.${to}`));
  };
  const cycle = () => go(SNAPS[(SNAPS.indexOf(snap) + 1) % SNAPS.length]);

  function onKeyDown(e: KeyboardEvent) {
    const i = SNAPS.indexOf(snap);
    if (e.key === "Enter" || e.key === " ") cycle();
    else if (e.key === "ArrowUp") go(SNAPS[Math.min(i + 1, SNAPS.length - 1)]);
    else if (e.key === "ArrowDown") go(SNAPS[Math.max(i - 1, 0)]);
    else return;
    e.preventDefault();
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    const el = sheet.current;
    if (!el || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      startY: e.clientY,
      startHeight: el.getBoundingClientRect().height,
      max: el.parentElement?.clientHeight ?? window.innerHeight,
      moved: false,
    };
  }
  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const by = d.startY - e.clientY;
    if (!d.moved && Math.abs(by) < 5) return;
    d.moved = true;
    setDragHeight(Math.min(Math.max(d.startHeight + by, PEEK_PX), d.max));
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved || dragHeight === null) return;
    // Released: the nearest snap point. The click that follows a drag is not a press.
    dragged.current = true;
    const heights: Record<Snap, number> = {
      peek: PEEK_PX,
      half: d.max / 2,
      full: d.max,
    };
    go(SNAPS.reduce((best, s) => (Math.abs(heights[s] - dragHeight) < Math.abs(heights[best] - dragHeight) ? s : best)));
    setDragHeight(null);
  }

  return (
    <div
      ref={sheet}
      data-snap={off ? undefined : snap}
      style={
        {
          "--sheet-h": dragHeight === null ? HEIGHT[snap] : `${dragHeight}px`,
        } as React.CSSProperties
      }
      className={
        off
          ? "contents"
          : "max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-10 max-lg:flex max-lg:h-[var(--sheet-h)] max-lg:flex-col max-lg:overflow-hidden max-lg:rounded-t-[22px] max-lg:bg-paper max-lg:shadow-[0_-8px_30px_-8px_rgba(28,27,25,.22),0_-1px_0_rgba(28,27,25,.05)] max-lg:motion-safe:transition-[height] lg:contents"
      }
      onFocus={(e) => {
        if (!off && snap === "peek" && !e.currentTarget.querySelector("[data-sheet-handle]")?.contains(e.target)) go("half");
      }}
    >
      {!off && (
        <button
          type="button"
          data-sheet-handle
          aria-label={t("sheetHandle")}
          className="grid h-7 w-full shrink-0 touch-none place-items-center lg:hidden"
          onKeyDown={onKeyDown}
          onClick={() => {
            if (dragged.current) dragged.current = false;
            else cycle();
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
            setDragHeight(null);
          }}
        >
          <span aria-hidden="true" className="h-[5px] w-[38px] rounded-[3px] bg-[#d6d2ca]" />
        </button>
      )}
      {!off && (
        <p role="status" className="sr-only">
          {announced}
        </p>
      )}
      {children}
    </div>
  );
}

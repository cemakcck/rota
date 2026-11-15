"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useLocale, useTranslations } from "next-intl";
import { DAY_TITLE_MAX, dayTitle, type DayView, type TripView } from "@rota/trip";
import { apiFetch } from "@/client/authClient";
import { errorMessage, readError } from "@/client/apiError";
import { dayColour } from "../map/mapFeatures";
import { Icon } from "./icons";
import { railDayDragId } from "./plan";
import type { TripViewState } from "./view";

/** Drop targets on the rail: dragging a row onto a day moves it there, onto Ideas unschedules it. */
export const railDayDropId = (dayId: string) => `rail:day:${dayId}`;
export const RAIL_IDEAS_DROP_ID = "rail:ideas";

const entry =
  "w-full rounded-xl border border-transparent px-3 text-left hover:bg-hover aria-[current=true]:border-line aria-[current=true]:bg-surface aria-[current=true]:shadow-1 max-lg:w-auto max-lg:shrink-0";
const overLook = "outline-2 outline-dashed outline-ink-2 -outline-offset-2";
/** A day chip on phones (and the strip's other chips). */
const chip =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-ink hover:bg-hover aria-[current=true]:border-ink aria-[current=true]:bg-ink aria-[current=true]:text-white disabled:opacity-60";

/** What can be done to a day from the rail (its ⋯ menu, or dragging it); null while the user cannot edit. */
export type DayActions = {
  /** Moves the day to a position (0-based); false when nothing moved. */
  move(dayId: string, toIndex: number): boolean;
  rename(dayId: string, title: string): void;
  /** Deletes the day: its places go to Ideas (one undo step, with an Undo toast). */
  remove(dayId: string): void;
};

/** The id of a rail day's select button and ⋯ button (focus goes back to them). */
export const railDayButtonId = (dayId: string) => `rail-day-${dayId}`;
export const railDayMenuId = (dayId: string) => `rail-day-menu-${dayId}`;

const menuItem =
  "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium hover:bg-hover aria-disabled:cursor-default aria-disabled:text-ink-2 aria-disabled:hover:bg-transparent";

/**
 * A day's ⋯ menu on the rail: Move up, Move down, Rename (its title) and Delete day. A disclosure like
 * Shift times: its group follows the button in the tab order, Escape or a press elsewhere closes it and
 * focus goes back to ⋯ (Escape on ⋯ itself too). Drawn fixed under the button, so the rail's scrolling
 * does not clip it; a scroll or resize closes it. Move up/down keep it open (and focus on what was used)
 * so a day can be moved several places in a row: it follows its button, and the moved day is scrolled
 * into view. At an end they stay focusable but do nothing (aria-disabled), like Delete day on the only
 * day. A title being typed is saved however the menu closes, except by Escape.
 */
function DayMenu({ day, n, total, actions }: { day: DayView; n: number; total: number; actions: DayActions }) {
  const t = useTranslations("rail");
  const tt = useTranslations("trip");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [at, setAt] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // The title being typed, if any: closing the menu any way but Escape saves it.
  const typed = useRef<string | null>(null);
  // Until then, scrolls are this menu's own (bringing a moved day into view): they move it, not close it.
  const ownScrollUntil = useRef(0);
  const placed = useRef<number | null>(null);

  // Placed under ⋯ (kept on screen); again after a move, with the moved day brought into view.
  const place = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = 208;
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), width });
  };
  useLayoutEffect(() => {
    if (!open) {
      placed.current = null;
      return;
    }
    if (placed.current !== null && placed.current !== n) {
      ownScrollUntil.current = Date.now() + 500;
      document.getElementById(railDayButtonId(day.id))?.scrollIntoView?.({ block: "nearest" });
    }
    placed.current = n;
    place();
  }, [open, n, day.id]);
  useEffect(() => {
    if (!open) return;
    const shut = () => {
      if (typed.current !== null && dayTitle(typed.current) !== day.title) actions.rename(day.id, typed.current);
      typed.current = null;
      setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !box.current?.contains(e.target) && !button.current?.contains(e.target)) shut();
    };
    const onMove = (e: Event) => {
      if (e.target instanceof Node && box.current?.contains(e.target)) return;
      if (e.type === "scroll" && Date.now() < ownScrollUntil.current) return place();
      shut();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onMove);
    document.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("scroll", onMove, true);
    };
  }, [open, actions, day.id, day.title]);
  if (!open && renaming) setRenaming(false);

  const close = () => {
    typed.current = null;
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  };
  const move = (by: -1 | 1, from: HTMLElement) => {
    const to = n - 1 + by;
    if (to < 0 || to >= total || !actions.move(day.id, to)) return;
    // The rail reorders its entries: focus stays on the button used.
    requestAnimationFrame(() => from.isConnected && document.activeElement !== from && from.focus());
  };
  // Saved only when it changes the title: leaving it as it was writes nothing.
  const save = (value: string) => {
    if (dayTitle(value) !== day.title) actions.rename(day.id, value);
  };
  const commit = () => {
    save(draft);
    close();
  };
  const edit = (value: string) => {
    setDraft(value);
    typed.current = value;
  };
  const first = n === 1;
  const last = n === total;

  return (
    <>
      <button
        ref={button}
        id={railDayMenuId(day.id)}
        type="button"
        aria-label={t("dayMenu", { n })}
        title={t("dayMenu", { n })}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !open) return;
          e.stopPropagation();
          close();
        }}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink max-lg:size-11"
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          ref={box}
          id={id}
          role="group"
          aria-label={t("dayMenu", { n })}
          style={at}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            close();
          }}
          className="fixed z-30 grid gap-0.5 rounded-xl border border-line bg-surface p-1.5 shadow-2"
        >
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
            >
              <label htmlFor={`${id}-title`} className="mb-1 block px-1 text-[12.5px] font-medium text-ink-2">
                {tt("dayTitleFor", { n })}
              </label>
              <input
                id={`${id}-title`}
                autoFocus
                value={draft}
                maxLength={DAY_TITLE_MAX}
                placeholder={tt("dayTitlePlaceholder")}
                onChange={(e) => edit(e.target.value)}
                // Tabbing away saves too (as the day header's title does), like a press elsewhere, a scroll or
                // a resize; only Escape drops it.
                onBlur={(e) => {
                  if (e.relatedTarget instanceof Node && !box.current?.contains(e.relatedTarget)) {
                    save(draft);
                    typed.current = null;
                    setOpen(false);
                  }
                }}
                className="h-9 w-full min-w-0 rounded-md border border-ink-2 bg-surface px-2 text-[13.5px]"
              />
            </form>
          ) : (
            <>
              <button type="button" className={`${menuItem} text-ink`} aria-disabled={first || undefined} onClick={(e) => !first && move(-1, e.currentTarget)}>
                <Icon name="up" size={14} />
                {t("moveUp")}
              </button>
              <button type="button" className={`${menuItem} text-ink`} aria-disabled={last || undefined} onClick={(e) => !last && move(1, e.currentTarget)}>
                <Icon name="down" size={14} />
                {t("moveDown")}
              </button>
              <button
                type="button"
                className={`${menuItem} text-ink`}
                onClick={() => {
                  setDraft(day.title);
                  typed.current = null;
                  setRenaming(true);
                }}
              >
                <Icon name="pencil" size={14} />
                {t("rename")}
              </button>
              <button
                type="button"
                className={`${menuItem} text-danger aria-disabled:text-ink-2`}
                aria-disabled={total <= 1 || undefined}
                aria-describedby={total <= 1 ? `${id}-last` : undefined}
                onClick={() => {
                  if (total <= 1) return;
                  setOpen(false);
                  actions.remove(day.id);
                }}
              >
                <Icon name="trash" size={14} />
                {t("deleteDay")}
              </button>
              {total <= 1 && (
                <p id={`${id}-last`} className="px-2.5 pb-1 text-[12px] text-ink-2">
                  {t("lastDay")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

function RailDay({
  day,
  label,
  summary,
  selected,
  onSelect,
  total,
  actions,
  compact,
}: {
  day: DayView;
  label: string;
  summary: string;
  selected: boolean;
  onSelect(): void;
  total: number;
  actions: DayActions | null;
  compact: boolean;
}) {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: railDayDropId(day.id) });
  // Dragged by pointer only (the ⋯ menu's Move up/down is the keyboard way), so dnd-kit's attributes
  // (a "draggable" role description and keyboard instructions) stay off. Not the phone's chips: a
  // finger on them scrolls the strip.
  const { setNodeRef: dragRef, listeners, isDragging } = useDraggable({ id: railDayDragId(day.id), disabled: actions === null || compact });
  if (compact)
    return (
      <>
        <button ref={dropRef} id={railDayButtonId(day.id)} type="button" data-drop={railDayDropId(day.id)} aria-current={selected ? "true" : undefined} onClick={onSelect} className={`${chip} ${isOver ? overLook : ""}`}>
          <span data-day-colour aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: dayColour(day.index) }} />
          {label}
        </button>
        {/* The chosen day's ⋯ only, to keep the strip short. */}
        {actions && selected && <DayMenu day={day} n={day.index + 1} total={total} actions={actions} />}
      </>
    );
  return (
    <div className={`flex items-start gap-0.5 max-lg:shrink-0 ${isDragging ? "opacity-50" : ""}`}>
      <button
        ref={(el) => {
          dropRef(el);
          dragRef(el);
        }}
        id={railDayButtonId(day.id)}
        type="button"
        data-drop={railDayDropId(day.id)}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        {...listeners}
        className={`${entry} grid min-w-0 gap-0.5 py-2.5 ${actions ? "lg:flex-1" : ""} ${isOver ? overLook : ""}`}
      >
        <span className="flex items-center gap-1.5 font-semibold">
          <span data-day-colour aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: dayColour(day.index) }} />
          {label}
        </span>
        <span className="truncate text-[12px] text-ink-2" title={summary}>
          {summary}
        </span>
      </button>
      {actions && (
        <div className="pt-1.5">
          <DayMenu day={day} n={day.index + 1} total={total} actions={actions} />
        </div>
      )}
    </div>
  );
}

type TabProps = { label: string; name?: string; count?: string; selected: boolean; onSelect(): void };

/** A rail entry that is not a day: Ideas & votes, the checklist, the whole trip. */
function RailTab({ label, name, count, selected, onSelect, drop }: TabProps & { drop?: { id: string; ref(el: HTMLElement | null): void; over: boolean } }) {
  return (
    <button
      ref={drop?.ref}
      type="button"
      data-drop={drop?.id}
      aria-label={name}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={`${entry} flex items-center justify-between gap-2 py-2 text-ink-2 aria-[current=true]:font-medium aria-[current=true]:text-ink ${drop?.over ? overLook : ""}`}
    >
      {label}
      {count !== undefined && <span className="rounded-full bg-paper px-2 text-[12px] text-ink-2">{count}</span>}
    </button>
  );
}

/** A rail entry rows can be dropped on (Ideas). */
function RailDropTab({ id, ...props }: TabProps & { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <RailTab {...props} drop={{ id, ref: setNodeRef, over: isOver }} />;
}

/**
 * The trip's left rail on wide screens: each day
 * with its colour, date and a one-line summary (its title, else how many stops), "Add a day", then Ideas & votes, the checklist and the
 * whole trip on the map, and the demo box at the bottom. Days and Ideas are drop targets for rows; an editor
 * also drags days onto each other to reorder them, or uses each day's ⋯ menu (Move up/down, Rename, Delete day).
 * On phones (`compact`, spec §6) it is the header's strip of day chips (Day 1 · Day 2 · … · All) with the
 * chosen day's ⋯ menu and "Add a day"; Ideas and the checklist are the phone's tabs, and the demo box
 * goes under the plan (see TripScreen). The same element in
 * both layouts, so a resize keeps it (and the tour's spotlight on it).
 */
export function Rail({
  tripId,
  trip,
  selected,
  onSelect,
  canAddDay,
  dayActions,
  demo,
  compact = false,
}: {
  tripId: string;
  trip: TripView;
  selected: TripViewState;
  onSelect(v: TripViewState): void;
  /** Whether this user may add a day now (known and online-capable editor). */
  canAddDay: boolean;
  /** Reordering, renaming and deleting days; null while the user cannot edit. */
  dayActions: DayActions | null;
  demo?: ReactNode;
  /** The phone's day chips instead of the rail. */
  compact?: boolean;
}) {
  const t = useTranslations("rail");
  const tt = useTranslations("trip");
  const te = useTranslations("errors");
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState("");
  // "Fri 27" / "27 Cum": the weekday and the day of the month (dates, so in UTC).
  const date = (d: string) => {
    if (!d) return "";
    const at = new Date(`${d}T00:00:00Z`);
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(at);
    return t("date", { weekday, day: at.getUTCDate() });
  };
  // Phones: the chosen chip is scrolled into the strip (a deep link to Day 4 shows Day 4).
  const strip = useRef<HTMLElement>(null);
  const selectedKey = selected.kind === "day" ? selected.dayId : selected.kind;
  useEffect(() => {
    const nav = strip.current;
    const chosen = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!compact || !nav || !chosen) return;
    if (chosen.offsetLeft < nav.scrollLeft || chosen.offsetLeft + chosen.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = chosen.offsetLeft - 12;
  }, [compact, selectedKey]);
  const done = trip.checklist.filter((i) => i.done).length;
  const ideas = trip.ideas.length + trip.suggestions.length;

  // A day more goes through the trip's details, as in the settings (the server keeps the day count).
  async function addDay() {
    setAdding(true);
    setFailure("");
    try {
      const res = await apiFetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: trip.days.length + 1 }),
      });
      if (!res.ok) setFailure(errorMessage(te, await readError(res)));
    } catch {
      setFailure(te("offline"));
    } finally {
      setAdding(false);
    }
  }

  return (
    <nav
      ref={strip}
      data-tour="days"
      aria-label={compact ? t("days") : t("label")}
      className={
        compact
          ? "relative z-20 flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-surface px-3 py-1.5 [scrollbar-width:none]"
          : "flex gap-1.5 border-line bg-paper px-3 py-4 max-lg:relative max-lg:z-20 max-lg:items-center max-lg:overflow-x-auto max-lg:border-b max-lg:py-2 lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:border-r"
      }
    >
      {trip.days.map((day) => (
        <RailDay
          key={day.id}
          day={day}
          label={t("day", { n: day.index + 1, date: date(day.date) })}
          summary={day.title || t("stops", { count: day.places.length })}
          selected={selected.kind === "day" && selected.dayId === day.id}
          onSelect={() => onSelect({ kind: "day", dayId: day.id })}
          total={trip.days.length}
          actions={dayActions}
          compact={compact}
        />
      ))}
      {canAddDay && trip.days.length < 30 && (
        <button type="button" disabled={adding} onClick={addDay} className={compact ? `${chip} text-ink-2` : `${entry} py-2 text-ink-2 disabled:opacity-60`}>
          {`+ ${t("addDay")}`}
        </button>
      )}
      {failure && (
        <p role="alert" className="px-3 text-[12.5px] font-medium text-danger">
          {failure}
        </p>
      )}
      {compact ? (
        <button type="button" aria-current={selected.kind === "all" ? "true" : undefined} onClick={() => onSelect({ kind: "all" })} className={chip}>
          {t("allShort")}
        </button>
      ) : (
        <>
          <hr className="mx-1 my-2 border-line max-lg:hidden" />
          <RailDropTab
            label={t("ideas")}
            name={t("ideasCount", { count: ideas })}
            count={String(ideas)}
            id={RAIL_IDEAS_DROP_ID}
            selected={selected.kind === "ideas"}
            onSelect={() => onSelect({ kind: "ideas" })}
          />
          <RailTab
            label={tt("checklist")}
            name={trip.checklist.length > 0 ? `${tt("checklist")}, ${tt("checklistDone", { done, total: trip.checklist.length })}` : undefined}
            count={trip.checklist.length > 0 ? `${done}/${trip.checklist.length}` : undefined}
            selected={selected.kind === "checklist"}
            onSelect={() => onSelect({ kind: "checklist" })}
          />
          <RailTab label={t("all")} selected={selected.kind === "all"} onSelect={() => onSelect({ kind: "all" })} />
        </>
      )}
      {demo && !compact && <div className="max-lg:shrink-0 lg:mt-auto lg:pt-3">{demo}</div>}
    </nav>
  );
}

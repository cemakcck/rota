"use client";

import { useState, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useLocale, useTranslations } from "next-intl";
import * as Y from "yjs";
import { dayNote, type DayView, type TripView } from "@rota/trip";
import { apiFetch } from "@/client/authClient";
import { errorMessage, readError } from "@/client/apiError";
import { dayColour } from "../map/mapFeatures";
import { noteOrNull } from "./NoteEditor";
import type { TripViewState } from "./view";

/** Drop targets on the rail: dragging a row onto a day moves it there, onto Ideas unschedules it. */
export const railDayDropId = (dayId: string) => `rail:day:${dayId}`;
export const RAIL_IDEAS_DROP_ID = "rail:ideas";

/** Plain text of a note node (Tiptap's XML: elements holding text). */
function plain(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return (node.toDelta() as { insert: unknown }[]).map((d) => (typeof d.insert === "string" ? d.insert : "")).join("");
  if (node instanceof Y.XmlElement) return node.toArray().map(plain).join("");
  return "";
}

/** A day note's first non-empty paragraph (or list item), as plain text. */
export function noteFirstLine(note: Y.XmlFragment): string {
  const blocks = (nodes: (Y.XmlElement | Y.XmlText | Y.XmlHook)[]): string => {
    for (const node of nodes) {
      if (!(node instanceof Y.XmlElement)) continue;
      const children = node.toArray();
      const text = children.some((c) => c instanceof Y.XmlText) ? plain(node).trim() : blocks(children);
      if (text) return text;
    }
    return "";
  };
  return blocks(note.toArray());
}

const entry =
  "w-full rounded-xl border border-transparent px-3 text-left hover:bg-hover aria-[current=true]:border-line aria-[current=true]:bg-surface aria-[current=true]:shadow-1 max-lg:w-auto max-lg:shrink-0";
const overLook = "outline-2 outline-dashed outline-ink-2 -outline-offset-2";

function RailDay({ day, label, summary, selected, onSelect }: { day: DayView; label: string; summary: string; selected: boolean; onSelect(): void }) {
  const { setNodeRef, isOver } = useDroppable({ id: railDayDropId(day.id) });
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-drop={railDayDropId(day.id)}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={`${entry} grid gap-0.5 py-2.5 ${isOver ? overLook : ""}`}
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <span data-day-colour aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: dayColour(day.index) }} />
        {label}
      </span>
      <span className="truncate text-[12px] text-ink-2" title={summary}>
        {summary}
      </span>
    </button>
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
 * The trip's left rail (desktop; a scrolling strip on phones until the phone layout lands): each day
 * with its colour, date and a one-line summary, "Add a day", then Ideas & votes, the checklist and the
 * whole trip on the map, and the demo box at the bottom. Days and Ideas are drop targets for rows.
 */
export function Rail({
  tripId,
  doc,
  trip,
  selected,
  onSelect,
  canAddDay,
  demo,
}: {
  tripId: string;
  doc: Y.Doc;
  trip: TripView;
  selected: TripViewState;
  onSelect(v: TripViewState): void;
  /** Whether this user may add a day now (known and online-capable editor). */
  canAddDay: boolean;
  demo?: ReactNode;
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
      aria-label={t("label")}
      className="flex gap-1.5 border-line bg-paper px-3 py-4 max-lg:relative max-lg:z-20 max-lg:items-center max-lg:overflow-x-auto max-lg:border-b max-lg:py-2 lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:border-r"
    >
      {trip.days.map((day) => {
        const fragment = noteOrNull(() => dayNote(doc, day.id));
        const note = fragment ? noteFirstLine(fragment) : "";
        const stops = t("stops", { count: day.places.length });
        return (
          <RailDay
            key={day.id}
            day={day}
            label={t("day", { n: day.index + 1, date: date(day.date) })}
            summary={note ? `${note} · ${stops}` : stops}
            selected={selected.kind === "day" && selected.dayId === day.id}
            onSelect={() => onSelect({ kind: "day", dayId: day.id })}
          />
        );
      })}
      {canAddDay && trip.days.length < 30 && (
        <button type="button" disabled={adding} onClick={addDay} className={`${entry} py-2 text-ink-2 disabled:opacity-60`}>
          {`+ ${t("addDay")}`}
        </button>
      )}
      {failure && (
        <p role="alert" className="px-3 text-[12.5px] font-medium text-danger">
          {failure}
        </p>
      )}
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
      {demo && <div className="max-lg:shrink-0 lg:mt-auto lg:pt-3">{demo}</div>}
    </nav>
  );
}

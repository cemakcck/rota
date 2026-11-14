"use client";

import { useState, type KeyboardEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { placeUrl, type MemberView, type PlaceView } from "@rota/trip";
import { btn, btnSm } from "../ui";
import { CategoryIcon, GoogleMapsPin, Icon } from "./icons";
import { PlaceEditor, type PlaceEdit } from "./PlaceEditor";
import { placeDropId } from "./plan";

/** What a member can do to a place; absent while the user is unknown (read-only). */
export type PlaceActions = {
  save(id: string, edit: PlaceEdit): void;
  setStay(id: string, minutes: number): void;
  /** Swaps with the neighbour above (-1) or below (1) in the same list. */
  nudge(id: string, by: -1 | 1): void;
  openMove(id: string): void;
  remove(place: PlaceView): void;
};

/** The id of a place's Edit button, where focus goes back to after editing, moving or undoing. */
export const placeFocusId = (id: string) => `place-edit-${id}`;
/** The id of a place's Move to… button, where focus goes back to when the Move dialog closes. */
export const placeMoveId = (id: string) => `place-move-${id}`;

const ghost = "grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-40";

/** The stay in minutes, saved when the field is left or Enter is pressed. Remounted (by key) when it changes elsewhere. */
function StayInput({ place, onSave }: { place: PlaceView; onSave: (minutes: number) => void }) {
  const t = useTranslations("trip");
  const [value, setValue] = useState(String(place.stayMinutes));
  const commit = () => {
    const minutes = Number(value);
    if (value.trim() === "" || !Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return setValue(String(place.stayMinutes));
    if (Math.round(minutes) !== place.stayMinutes) onSave(Math.round(minutes));
  };
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-ink-2">
      <input
        type="number"
        min={0}
        max={1440}
        step={5}
        inputMode="numeric"
        aria-label={t("stayFor", { name: place.name || t("unnamed") })}
        className="h-7 w-14 rounded-md border border-line bg-surface px-1.5 text-right font-mono text-[12px] text-ink"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") commit();
        }}
      />
      {t("minutes")}
    </span>
  );
}

/**
 * One place in a day or in Ideas: category, name, who added it, tags, estimated arrival, stay, and
 * the actions. Every drag has button alternatives (up/down, Move to…); the drag handle is for pointers
 * only and hidden from assistive technology.
 */
export function PlaceRow({
  place,
  number,
  first,
  last,
  arrival,
  dimmed,
  members,
  actions,
}: {
  place: PlaceView;
  /** Stop number within a day; none in Ideas. */
  number?: number;
  first: boolean;
  last: boolean;
  arrival?: string;
  dimmed: boolean;
  members: MemberView[];
  actions: PlaceActions | null;
}) {
  const t = useTranslations("trip");
  const tc = useTranslations("categories");
  const [editing, setEditing] = useState(false);
  const name = place.name || t("unnamed");
  const { setNodeRef: setDragRef, listeners, isDragging } = useDraggable({ id: place.id, disabled: !actions });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: placeDropId(place.id), disabled: !actions });
  const by = members.find((m) => m.id === place.addedBy);

  const focusEdit = () => requestAnimationFrame(() => document.getElementById(placeFocusId(place.id))?.focus());

  return (
    <li
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      data-dimmed={dimmed || undefined}
      // Dimmed by filters: a quieter row whose text keeps AA contrast (no opacity on text).
      className={`relative grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-xl border p-3 ${
        isOver && !isDragging ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-line"
      } ${dimmed ? "bg-line-2 text-ink-2" : "bg-surface"} ${isDragging ? "opacity-40" : ""}`}
    >
      <span className="flex items-center gap-1 pt-1">
        {actions && (
          <span aria-hidden="true" className="-ml-1 cursor-grab touch-none rounded p-0.5 text-ink-2 active:cursor-grabbing" {...listeners}>
            <Icon name="grip" size={16} />
          </span>
        )}
        {number !== undefined && (
          <span className="grid size-[22px] place-items-center rounded-full bg-ink font-mono text-[11px] font-semibold text-white">{number}</span>
        )}
      </span>
      <CategoryIcon category={place.category} label={tc(place.category)} />
      <div className="min-w-0">
        <p data-testid="place-name" className="text-[14px] font-semibold leading-snug tracking-[-0.005em] [overflow-wrap:anywhere]">
          {name}
        </p>
        <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
          {by && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-[7px] rounded-full" style={{ background: by.colour }} />
              {by.name}
            </span>
          )}
          {place.tags.map((tag) => (
            <span key={tag} className="inline-flex h-5 min-w-0 items-center rounded-md bg-line-2 px-1.5 text-[11.5px] font-medium [overflow-wrap:anywhere]">
              {tag}
            </span>
          ))}
          {dimmed && <span className="font-medium">{t("hiddenByFilters")}</span>}
        </p>
      </div>
      <div className="grid justify-items-end gap-1 text-right">
        {arrival && <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums">{t("arrive", { time: arrival })}</span>}
        {actions ? (
          <StayInput key={place.stayMinutes} place={place} onSave={(m) => actions.setStay(place.id, m)} />
        ) : (
          <span className="font-mono text-[11.5px] text-ink-2">
            {place.stayMinutes} {t("minutes")}
          </span>
        )}
      </div>

      <div className="col-span-full flex flex-wrap items-center gap-1">
        <a href={placeUrl(place)} target="_blank" rel="noopener noreferrer" className={`${btn} ${btnSm} mr-auto`}>
          <GoogleMapsPin />
          {t("openPlace")}
          <span className="sr-only">
            {" "}
            — {name} ({t("newTab")})
          </span>
          <Icon name="ext" size={12} className="text-ink-2" />
        </a>
        {actions && (
          <>
            <button
              type="button"
              id={placeFocusId(place.id)}
              className={ghost}
              aria-label={t("editFor", { name })}
              aria-expanded={editing}
              onClick={() => setEditing((e) => !e)}
            >
              <Icon name="pencil" />
            </button>
            <button type="button" className={ghost} aria-label={t("moveUpFor", { name })} aria-disabled={first || undefined} onClick={() => !first && actions.nudge(place.id, -1)}>
              <Icon name="up" />
            </button>
            <button type="button" className={ghost} aria-label={t("moveDownFor", { name })} aria-disabled={last || undefined} onClick={() => !last && actions.nudge(place.id, 1)}>
              <Icon name="down" />
            </button>
            <button type="button" id={placeMoveId(place.id)} className={ghost} aria-label={t("moveToFor", { name })} aria-haspopup="dialog" onClick={() => actions.openMove(place.id)}>
              <Icon name="move" />
            </button>
            <button type="button" className={ghost} aria-label={t("deleteFor", { name })} onClick={() => actions.remove(place)}>
              <Icon name="trash" />
            </button>
          </>
        )}
      </div>

      {editing && actions && (
        <PlaceEditor
          place={place}
          onCancel={() => {
            setEditing(false);
            focusEdit();
          }}
          onSave={(edit) => {
            actions.save(place.id, edit);
            setEditing(false);
            focusEdit();
          }}
        />
      )}
    </li>
  );
}

"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { placeNote, placeUrl, type Leg, type MemberView, type PlaceView, type TimelineEntry, type TravelMode } from "@rota/trip";
import type { StopHours, StopWarning } from "@/client/useHours";
import { btn, btnSm, errorText } from "../ui";
import { CategoryPicker } from "./CategoryPicker";
import { CommitInput } from "./CommitInput";
import { HoursWarning } from "./HoursWarning";
import { GoogleMapsPin, Icon } from "./icons";
import { NoteEditor, noteOrNull } from "./NoteEditor";
import { useCollab } from "./Presence";
import { WarnLine, placeMoveId, type StopActions } from "./StopRow";
import { TagInput } from "./TagInput";
import { Approximate, TravelLeg, useStay } from "./TravelLeg";
import { parseTime } from "./plan";

/** Stay lengths offered in the details (the place's own one is added when it is not among them). */
const STAYS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480];

/** Where the stop is: its day (number, colour, timeline) or Ideas. */
export type DetailsWhere =
  | { kind: "day"; label: string; number: number; colour: string; mode: TravelMode; timing?: TimelineEntry; leg?: Leg | null; late: { minutes: number; from: string } | null }
  | { kind: "ideas"; label: string };

const tile = "min-w-0 rounded-[10px] bg-paper px-3 py-2";
const tileLabel = "block text-[11.5px] text-ink-2";

function Tile({ label, labelFor, children }: { label: string; labelFor?: string; children: ReactNode }) {
  return (
    <div className={tile}>
      {labelFor ? (
        <label htmlFor={labelFor} className={tileLabel}>
          {label}
        </label>
      ) : (
        <span className={tileLabel}>{label}</span>
      )}
      <div className="mt-0.5 min-w-0 text-[13.5px] font-semibold">{children}</div>
    </div>
  );
}

/**
 * The stop's own time, always open in the details: prefilled with the set time, or the estimate when
 * it has none. Enter (or leaving it changed) saves; leaving it untouched saves nothing (an estimate is
 * not pinned); empty clears; something that is not a time stays, saying why; Escape undoes the typing.
 */
function TimeField({ id, place, estimate, onSet }: { id: string; place: PlaceView; estimate: string | null; onSet: (time: string | null) => void }) {
  const t = useTranslations("trip");
  const initial = place.time ?? estimate ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? initial;
  const errorId = `${id}-error`;
  const reset = () => {
    setDraft(null);
    setInvalid(false);
  };
  const commit = () => {
    const parsed = parseTime(value);
    if (parsed === null) return setInvalid(true);
    reset();
    const time = parsed === "" ? null : parsed;
    if (time !== place.time) onSet(time);
  };
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        maxLength={5}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className="h-8 w-[72px] rounded-md border border-ink-2 bg-surface px-1.5 text-[13.5px] font-semibold tabular-nums aria-[invalid=true]:border-danger"
        value={value}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape" && (draft !== null || invalid)) {
            // Undoes the typing first; a second Escape closes the details.
            e.stopPropagation();
            reset();
          }
        }}
        onBlur={() => (draft === null || draft === initial ? reset() : commit())}
      />
      {place.time === null && estimate !== null && !invalid && <span className="ml-1.5 text-[12px] font-normal text-ink-2">{t("estimated")}</span>}
      {invalid && (
        <p id={errorId} className={errorText}>
          {t("timeInvalid")}
        </p>
      )}
    </>
  );
}

/**
 * A stop's details (spec §2): its category chip with number and day, name, who added it; tiles for
 * Arrive (its time), Stay, the travel from the stop before and today's opening hours (with any
 * warning); tags; the shared note; Google Maps; Move up/down, Move to… and Delete. On wide screens a
 * card over the map's left edge, on phones a full-height sheet; a labelled region that takes focus when
 * it opens and closes with ✕ or Escape (the caller puts focus back on the row). Read-only without
 * `actions`. While it is open, the place's row tells others it is being edited. The caller keys it by
 * place, so switching places starts afresh.
 */
export function PlaceDetails({
  place,
  where,
  addedBy,
  hours,
  warning,
  first,
  last,
  actions,
  onClose,
}: {
  place: PlaceView;
  where: DetailsWhere;
  addedBy?: MemberView;
  /** When it is open on its day; unknown when absent. */
  hours?: StopHours;
  warning?: StopWarning;
  /** First / last in its list (Move up / Move down stay focusable but do nothing there). */
  first: boolean;
  last: boolean;
  actions: StopActions | null;
  onClose(): void;
}) {
  const t = useTranslations("trip");
  const tc = useTranslations("categories");
  const stay = useStay();
  const collab = useCollab();
  const base = useId();
  const panel = useRef<HTMLElement>(null);
  const [picking, setPicking] = useState(false);
  // A tag being typed; the tags themselves save as they are added or removed.
  const [tagDraft, setTagDraft] = useState("");
  const name = place.name || t("unnamed");
  const note = collab && noteOrNull(() => placeNote(collab.doc, place.id));
  const ids = { name: `${base}-name`, time: `${base}-time`, stay: `${base}-stay`, tags: `${base}-tags`, chip: `${base}-chip` };

  // Focus comes into the details when they open, or switch to another place.
  useEffect(() => {
    const frame = requestAnimationFrame(() => panel.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [place.id]);
  // When the details go away with focus in them (the place deleted elsewhere), focus moves to the plan.
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) document.getElementById("main")?.focus();
      });
    },
    [],
  );

  const onKeyDown = (e: KeyboardEvent) => {
    // An open note's Escape closes the note.
    if (e.key !== "Escape" || (e.target instanceof Element && e.target.closest("[data-note-editor]"))) return;
    e.preventDefault();
    onClose();
  };

  const chipText = `${where.kind === "day" ? `${where.number} · ` : ""}${where.label} · ${tc(place.category)}`;
  const chipStyle = where.kind === "day" ? { color: where.colour, background: `${where.colour}1a` } : undefined;
  const chip = "inline-flex max-w-full items-center gap-1 rounded-full bg-paper px-2.5 py-0.5 text-[12px] font-semibold text-ink-2";
  const stays = [...new Set([...STAYS, place.stayMinutes])].sort((a, b) => a - b);
  const timing = where.kind === "day" ? where.timing : undefined;
  const arrive = timing?.arrive ?? null;

  return (
    <section
      ref={panel}
      id="place-details"
      tabIndex={-1}
      aria-label={t("detailsFor", { name })}
      onKeyDown={onKeyDown}
      className="rota-slide fixed inset-0 z-30 flex flex-col gap-3.5 overflow-y-auto bg-surface p-4 outline-none lg:absolute lg:inset-auto lg:bottom-4 lg:left-[624px] lg:top-4 lg:z-[5] lg:w-[340px] lg:rounded-2xl lg:p-[18px] lg:shadow-[0_18px_40px_-12px_rgba(0,0,0,.3)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 justify-items-start gap-1">
          {actions ? (
            <button type="button" id={ids.chip} aria-expanded={picking} aria-label={t("changeCategory", { category: tc(place.category) })} onClick={() => setPicking(!picking)} className={`${chip} hover:opacity-80`} style={chipStyle}>
              <span data-testid="details-chip" className="min-w-0 truncate">
                {chipText}
              </span>
              <Icon name="down" size={12} />
            </button>
          ) : (
            <span data-testid="details-chip" className={chip} style={chipStyle}>
              {chipText}
            </span>
          )}
          {actions ? (
            <>
              <h2 className="sr-only">{name}</h2>
              <CommitInput
                id={ids.name}
                aria-label={t("editorName")}
                value={place.name}
                maxLength={200}
                onCommit={(value) => value.trim() && actions.save(place.id, { name: value.trim() })}
                className="-mx-1 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 font-serif text-[20px] font-semibold leading-tight hover:border-line focus:border-ink-2"
              />
            </>
          ) : (
            <h2 className="font-serif text-[20px] font-semibold leading-tight [overflow-wrap:anywhere]">{name}</h2>
          )}
          {addedBy && <p className="text-[12.5px] text-ink-2">{t("addedBy", { name: addedBy.name })}</p>}
        </div>
        <button type="button" aria-label={t("close")} onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg bg-paper text-ink-2 hover:bg-hover">
          <Icon name="close" size={14} />
        </button>
      </div>

      {actions && picking && (
        <CategoryPicker
          name={`${base}-category`}
          value={place.category}
          onChange={(category) => {
            actions.save(place.id, { category });
            setPicking(false);
            requestAnimationFrame(() => document.getElementById(ids.chip)?.focus());
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        {where.kind === "day" && (
          <Tile label={t("arrive")} labelFor={actions ? ids.time : undefined}>
            {actions ? (
              <TimeField id={ids.time} place={place} estimate={arrive} onSet={(time) => actions.setTime(place.id, time)} />
            ) : (
              <span data-testid="details-time" className={`tabular-nums ${timing?.estimated ? "font-normal text-ink-2" : ""}`}>
                {arrive === null ? "—" : timing?.estimated ? (
                  <>
                    <Approximate />
                    {arrive}
                  </>
                ) : (
                  arrive
                )}
              </span>
            )}
          </Tile>
        )}
        <Tile label={t("stay")} labelFor={actions ? ids.stay : undefined}>
          {actions ? (
            <select
              id={ids.stay}
              value={place.stayMinutes}
              onChange={(e) => actions.save(place.id, { stayMinutes: Number(e.target.value) })}
              className="h-8 max-w-full rounded-md border border-ink-2 bg-surface px-1.5 text-[13.5px] font-semibold"
            >
              {stays.map((m) => (
                <option key={m} value={m}>
                  {stay(m)}
                </option>
              ))}
            </select>
          ) : (
            stay(place.stayMinutes)
          )}
        </Tile>
        {where.kind === "day" && (
          <>
            <Tile label={t("fromPrevious")}>
              <span data-testid="details-leg" className="font-normal">
                {where.number === 1 ? t("firstStop") : where.leg ? <TravelLeg leg={where.leg} mode={where.mode} /> : t("notKnown")}
              </span>
            </Tile>
            <Tile label={t("openingHours")}>
              <span data-testid="details-hours" className="tabular-nums">
                {hours === undefined ? t("notKnown") : hours.length === 0 ? t("hoursClosed") : hours.join(", ")}
              </span>
            </Tile>
          </>
        )}
      </div>
      {where.kind === "day" && where.late && <WarnLine text={t("late", { minutes: where.late.minutes, place: where.late.from })} />}
      {warning && <HoursWarning {...warning} />}

      {actions ? (
        <TagInput
          id={ids.tags}
          value={{ tags: place.tags, draft: tagDraft }}
          onChange={(next) => {
            setTagDraft(next.draft);
            if (next.tags.join("\n") !== place.tags.join("\n")) actions.save(place.id, { tags: next.tags });
          }}
        />
      ) : (
        place.tags.length > 0 && (
          <div>
            <h3 className="mb-1 text-[13px] font-medium">{t("tags")}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {place.tags.map((tag) => (
                <li key={tag} className="rounded-full bg-paper px-2.5 py-0.5 text-[12.5px] text-ink-2 [overflow-wrap:anywhere]">
                  {tag}
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {note && <NoteEditor fragment={note} awareness={collab?.awareness ?? null} name={name} editable={actions !== null} onOpenChange={() => undefined} />}

      <a href={placeUrl(place)} target="_blank" rel="noopener noreferrer" className={`${btn} w-full`}>
        <GoogleMapsPin />
        {t("openPlace")}
        <span className="sr-only">
          {" "}
          — {name} ({t("newTab")})
        </span>
        <Icon name="ext" size={12} className="text-ink-2" />
      </a>
      {actions && (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {/* The single-pointer way to reorder (WCAG 2.5.7), besides dragging and Alt+↑/↓. */}
          <button type="button" className={`${btn} ${btnSm} aria-disabled:opacity-40`} aria-label={t("moveUpFor", { name })} aria-disabled={first || undefined} onClick={() => !first && actions.nudge(place.id, -1)}>
            <Icon name="up" size={14} />
          </button>
          <button type="button" className={`${btn} ${btnSm} aria-disabled:opacity-40`} aria-label={t("moveDownFor", { name })} aria-disabled={last || undefined} onClick={() => !last && actions.nudge(place.id, 1)}>
            <Icon name="down" size={14} />
          </button>
          <button type="button" id={placeMoveId(place.id)} className={`${btn} ${btnSm} flex-1`} aria-haspopup="dialog" onClick={() => actions.openMove(place.id)}>
            <Icon name="move" size={14} />
            <span aria-hidden="true">{t("moveSubmit")}</span>
            <span className="sr-only">{t("moveToFor", { name })}</span>
          </button>
          <button type="button" className={`${btn} ${btnSm} flex-1 text-danger`} onClick={() => actions.remove(place)}>
            <Icon name="trash" size={14} />
            <span aria-hidden="true">{t("delete")}</span>
            <span className="sr-only">{t("deleteFor", { name })}</span>
          </button>
        </div>
      )}
    </section>
  );
}

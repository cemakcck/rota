"use client";

import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useLocale, useTranslations } from "next-intl";
import { haversineMeters } from "@rota/trip";
import { searchPlaces, SearchUnavailable, type SearchResult } from "@/client/geocode";
import { input } from "../ui";
import { CategoryIcon } from "./icons";

const DEBOUNCE_MS = 300;

type Props = {
  /** The input's id; the caller renders its label, whose text `label` repeats for the results list. */
  id: string;
  label: string;
  value: string;
  onValueChange(value: string): void;
  onPick(result: SearchResult): void;
  /** Results are biased towards this point (the trip's area). */
  near?: { lat: number; lng: number } | null;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  maxLength?: number;
  /** Enter with no result chosen (the typed text is what to add). */
  onEnter?(): void;
  /** Replaces the field's own look (the day plan's search bar draws its own box). */
  inputClassName?: string;
  /** Each result says how far it is from here (the day's last stop, or the destination). */
  from?: { lat: number; lng: number } | null;
  /** The result hovered or arrowed to (null when none), for a preview pin on the map. */
  onPreview?(result: SearchResult | null): void;
  /**
   * Results open under the caller's positioned box (it is `relative`), as wide as that box, instead of
   * under the field: the day plan's search box, so the list never reaches past the column.
   */
  anchorToParent?: boolean;
  /** A search to run as if typed (the empty day's quick searches): each new object runs once. */
  query?: { text: string } | null;
};

/** "680 m" or "7.9 km": to the nearest 10 m under a kilometre. */
function useDistance(): (meters: number) => string {
  const locale = useLocale();
  return (meters) => {
    const km = meters >= 1000;
    return new Intl.NumberFormat(locale, { style: "unit", unit: km ? "kilometer" : "meter", maximumFractionDigits: km ? 1 : 0 }).format(
      km ? meters / 1000 : Math.round(meters / 10) * 10,
    );
  };
}

/**
 * A place search field: an ARIA 1.2 combobox whose listbox shows OpenStreetMap places (Photon through
 * our proxy) 300 ms after typing stops. Arrow keys move through the results and Enter picks one; text
 * that is not picked stays plain text, so a place can always be added by name, including offline.
 */
export function PlaceSearch({
  id,
  label,
  value,
  onValueChange,
  onPick,
  near = null,
  inputRef,
  disabled,
  invalid,
  describedBy,
  placeholder,
  maxLength = 200,
  onEnter,
  inputClassName,
  from = null,
  onPreview,
  anchorToParent = false,
  query = null,
}: Props) {
  const t = useTranslations("trip");
  const tc = useTranslations("categories");
  const locale = useLocale();
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [active, setActive] = useState(-1);
  const [hovered, setHovered] = useState(-1);
  const distance = useDistance();
  const [problem, setProblem] = useState<"offline" | "unavailable" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef<AbortController>(undefined);
  const listId = `${id}-results`;
  const statusId = `${id}-status`;
  const open = results !== null && results.length > 0;

  // The preview pin follows the pointer, else the keyboard; none once the list closes.
  const previewed = open ? (results[hovered >= 0 ? hovered : active] ?? null) : null;
  const preview = useEffectEvent((result: SearchResult | null) => onPreview?.(result));
  useEffect(() => {
    preview(previewed);
  }, [previewed]);
  useEffect(() => () => preview(null), []);

  const cancel = () => {
    clearTimeout(timer.current);
    inflight.current?.abort();
  };
  useEffect(() => cancel, []);

  const close = () => {
    setResults(null);
    setActive(-1);
    setHovered(-1);
  };

  function change(text: string) {
    onValueChange(text);
    cancel();
    close();
    setProblem(null);
    const q = text.trim();
    if (q.length < 2) return;
    if (!navigator.onLine) return setProblem("offline");
    timer.current = setTimeout(() => {
      const controller = new AbortController();
      inflight.current = controller;
      searchPlaces(q.slice(0, 100), locale, near, controller.signal).then(
        (found) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setActive(-1);
          setHovered(-1);
        },
        (err) => {
          if (!controller.signal.aborted) setProblem(err instanceof SearchUnavailable ? "unavailable" : "offline");
        },
      );
    }, DEBOUNCE_MS);
  }

  const runQuery = useEffectEvent((text: string) => change(text));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runs a search asked for by a click outside the field, once per request
    if (query) runQuery(query.text);
  }, [query]);

  function pick(result: SearchResult) {
    cancel();
    close();
    onPick(result);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && onEnter && !(open && active >= 0)) {
      e.preventDefault();
      cancel();
      close();
      return onEnter();
    }
    if (!results || results.length === 0) return;
    const n = results.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const message = problem === "offline" ? t("searchOffline") : problem === "unavailable" ? t("searchUnavailable") : null;
  return (
    <div className={anchorToParent ? undefined : "relative"}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, message && statusId].filter(Boolean).join(" ") || undefined}
        className={inputClassName ?? input}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          // Under the field, or (anchorToParent) under the whole search box, as wide as it.
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-2"
          onMouseLeave={() => setHovered(-1)}
        >
          {results.map((r, i) => (
            <li
              key={r.osmId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps focus in the field, so the pick does not blur and close the list first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? -1 : h))}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover aria-selected:bg-hover aria-selected:outline-2 aria-selected:outline-ink"
            >
              <CategoryIcon category={r.category} label={tc(r.category)} small />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium [overflow-wrap:anywhere]">{r.name}</span>
                {r.label && <span className="block text-[12px] text-ink-2 [overflow-wrap:anywhere]">{r.label}</span>}
              </span>
              {from && (
                <span data-testid="result-distance" className="shrink-0 self-start whitespace-nowrap pt-0.5 text-[12px] tabular-nums text-ink-2">
                  {distance(haversineMeters(from, r))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p id={statusId} role="status" className={message ? "mt-1 text-[12.5px] text-ink-2" : "sr-only"}>
        {message ?? (results ? t("searchResults", { count: results.length }) : "")}
      </p>
    </div>
  );
}

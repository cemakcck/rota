"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CATEGORIES, type TripView } from "@rota/trip";
import { btn, btnSm } from "../ui";
import { Icon } from "./icons";
import { NO_FILTER, plannedLists, tripTags, type Filter } from "./plan";

/**
 * The search bar's Filter button and its popover: category (several at once) and tag. Places that do
 * not match are dimmed in the list (and hidden on the map); a line under the bar says how many, popover
 * open or not. Only categories the trip uses are offered; no categories, no button. The popover is
 * non-modal: Escape or a click elsewhere closes it, and focus goes back to the button.
 */
export function FilterPopover({ view, filter, onChange }: { view: TripView; filter: Filter; onChange: (f: Filter) => void }) {
  const t = useTranslations("trip");
  const tc = useTranslations("categories");
  const locale = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const used = new Set(plannedLists(view).flatMap((l) => l.places.map((p) => p.category)));
  const categories = CATEGORIES.filter((c) => used.has(c));
  const tags = tripTags(view, locale);
  const active = filter.categories.length + (filter.tag === null ? 0 : 1);

  // A press outside the popover and its button closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !box.current?.contains(e.target) && !button.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (categories.length === 0 && active === 0) return null;
  const toggle = (c: (typeof CATEGORIES)[number]) =>
    onChange({ ...filter, categories: filter.categories.includes(c) ? filter.categories.filter((x) => x !== c) : [...filter.categories, c] });

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border-l max-lg:h-11 border-line pl-2.5 pr-1.5 text-[12.5px] font-medium text-ink-2 hover:text-ink aria-expanded:text-ink"
      >
        <Icon name="filter" size={14} />
        {t("filter")}
        {active > 0 && (
          <span aria-hidden="true" className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 text-[11px] text-white">
            {active}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={box}
          id={id}
          role="region"
          aria-label={t("filters")}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setOpen(false);
            button.current?.focus();
          }}
          className="absolute right-0 top-full z-30 mt-2 grid w-[min(340px,calc(100vw-32px))] gap-3 rounded-xl border border-line bg-surface p-3 shadow-2"
        >
          <div role="group" aria-label={t("category")} className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={filter.categories.includes(c)}
                onClick={() => toggle(c)}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink-2 max-lg:h-11 max-lg:px-3.5 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white"
              >
                <Icon name={c} size={14} />
                {tc(c)}
              </button>
            ))}
          </div>
          {tags.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor={`${id}-tag`} className="text-[13px] font-medium">
                {t("tag")}
              </label>
              <select
                id={`${id}-tag`}
                className="h-8 max-lg:h-11 min-w-0 flex-1 rounded-lg border border-ink-2 bg-surface px-2 text-[13px]"
                value={filter.tag ?? ""}
                onChange={(e) => onChange({ ...filter, tag: e.target.value || null })}
              >
                <option value="">{t("allTags")}</option>
                {tags.map((tag) => (
                  <option key={tag.key} value={tag.key}>
                    {tag.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {active > 0 && (
            <button type="button" className={`${btn} ${btnSm} justify-self-start`} onClick={() => onChange(NO_FILTER)}>
              {t("clearFilters")}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** How many places the filters hide, under the search bar; always rendered, so a change is announced. */
export function HiddenCount({ hidden }: { hidden: number }) {
  const t = useTranslations("trip");
  return (
    <p role="status" className={hidden > 0 ? "px-5 pb-2 text-[12.5px] text-ink-2" : "sr-only"}>
      {hidden > 0 ? t("hiddenCount", { count: hidden }) : ""}
    </p>
  );
}

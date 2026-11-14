"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CATEGORIES, type TripView } from "@rota/trip";
import { btn, btnSm } from "../ui";
import { Icon } from "./icons";
import { NO_FILTER, plannedLists, tripTags, type Filter } from "./plan";

/**
 * Filter the plan by category (several at once) and tag. Places that do not match are dimmed in the
 * list (and hidden on the map); a note says how many. Only categories the trip uses are offered.
 */
export function Filters({ view, filter, hidden, onChange }: { view: TripView; filter: Filter; hidden: number; onChange: (f: Filter) => void }) {
  const t = useTranslations("trip");
  const tc = useTranslations("categories");
  const locale = useLocale();
  const tagId = useId();
  const used = new Set(plannedLists(view).flatMap((l) => l.places.map((p) => p.category)));
  const categories = CATEGORIES.filter((c) => used.has(c));
  const tags = tripTags(view, locale);
  if (categories.length === 0) return null;

  const toggle = (c: (typeof CATEGORIES)[number]) =>
    onChange({ ...filter, categories: filter.categories.includes(c) ? filter.categories.filter((x) => x !== c) : [...filter.categories, c] });

  return (
    <section aria-label={t("filters")} className="grid gap-2 px-4 pb-1 pt-3">
      <div role="group" aria-label={t("category")} className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={filter.categories.includes(c)}
            onClick={() => toggle(c)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink-2 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white"
          >
            <Icon name={c} size={14} />
            {tc(c)}
          </button>
        ))}
      </div>
      {tags.length > 0 && (
        <div className="flex items-center gap-2">
          <label htmlFor={tagId} className="text-[13px] font-medium">
            {t("tag")}
          </label>
          <select
            id={tagId}
            className="h-8 min-w-0 rounded-lg border border-ink-2 bg-surface px-2 text-[13px]"
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
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
        {/* Always rendered, so the count is announced when it appears. */}
        <p role="status">{hidden > 0 ? t("hiddenCount", { count: hidden }) : ""}</p>
        {hidden > 0 && (
          <button type="button" className={`${btn} ${btnSm}`} onClick={() => onChange(NO_FILTER)}>
            {t("clearFilters")}
          </button>
        )}
      </div>
    </section>
  );
}

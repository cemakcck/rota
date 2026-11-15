"use client";

import { useTranslations } from "next-intl";
import { CATEGORIES, type Category } from "@rota/trip";
import { Icon } from "./icons";

/** One category per place (spec §5): native radios with the category's icon and name. */
export function CategoryPicker({ name, value, onChange }: { name: string; value: Category; onChange: (c: Category) => void }) {
  const t = useTranslations("trip");
  const tc = useTranslations("categories");
  return (
    <fieldset>
      <legend className="mb-1 text-[13px] font-medium">{t("category")}</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
        {CATEGORIES.map((c) => (
          <label
            key={c}
            className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] max-lg:min-h-11 has-[:checked]:border-ink has-[:checked]:shadow-[0_0_0_1px_var(--color-ink)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink"
          >
            <input type="radio" name={name} value={c} checked={value === c} onChange={() => onChange(c)} className="sr-only" />
            <Icon name={c} size={16} className="text-ink-2" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{tc(c)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

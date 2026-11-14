"use client";

import { useTranslations } from "next-intl";
import { MEMBER_COLOURS } from "@rota/trip";
import { errorText, hint } from "../ui";

/** The 8 member colours as a radio group; each swatch has at least 3:1 contrast on white. */
export function ColourPicker({ value, onChange, error }: { value: string; onChange: (colour: string) => void; error?: string }) {
  const t = useTranslations("auth");
  return (
    <fieldset aria-describedby="colour-hint">
      <legend className="mb-1 text-[13px] font-medium">{t("colour")}</legend>
      <div role="radiogroup" aria-label={t("colour")} className="flex flex-wrap gap-2">
        {MEMBER_COLOURS.map((colour) => {
          const selected = value === colour;
          return (
            <button
              key={colour}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={t(`colourNames.${colour}`)}
              onClick={() => onChange(colour)}
              className="grid size-9 place-items-center rounded-full border-2 border-transparent aria-checked:border-ink"
            >
              <span className="grid size-6 place-items-center rounded-full text-white" style={{ background: colour }}>
                {selected && (
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="m3 8.5 3.2 3L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p id="colour-hint" className={hint}>
        {t("colourHint")}
      </p>
      {error && <p className={errorText}>{error}</p>}
    </fieldset>
  );
}

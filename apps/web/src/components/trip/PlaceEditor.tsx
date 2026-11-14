"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { normaliseTags, type Category, type PlaceView } from "@rota/trip";
import { btn, btnPrimary, btnSm, errorText, input, label } from "../ui";
import { CategoryPicker } from "./CategoryPicker";
import { TagInput, type TagState } from "./TagInput";

export type PlaceEdit = { name: string; category: Category; tags: string[]; stayMinutes: number };

/** Edits a place's name, category, tags and stay. Saves once, as one undo step. */
export function PlaceEditor({ place, onSave, onCancel }: { place: PlaceView; onSave: (edit: PlaceEdit) => void; onCancel: () => void }) {
  const t = useTranslations("trip");
  const tc = useTranslations("common");
  const [name, setName] = useState(place.name);
  const [category, setCategory] = useState(place.category);
  const [tags, setTags] = useState<TagState>({ tags: place.tags, draft: "" });
  const [stay, setStay] = useState(String(place.stayMinutes));
  const [nameError, setNameError] = useState(false);
  const id = `edit-${place.id}`;

  function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setNameError(true);
    const minutes = Number(stay);
    onSave({
      name: name.trim(),
      category,
      tags: normaliseTags([...tags.tags, ...tags.draft.split(",")]),
      stayMinutes: Number.isFinite(minutes) && stay.trim() !== "" ? Math.min(1440, Math.max(0, Math.round(minutes))) : place.stayMinutes,
    });
  }

  return (
    <form
      onSubmit={save}
      noValidate
      data-place-editor
      aria-label={t("editFor", { name: place.name || t("unnamed") })}
      className="col-span-full grid gap-4 border-t border-line-2 pt-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div>
        <label htmlFor={`${id}-name`} className={label}>
          {t("editorName")}
        </label>
        <input
          id={`${id}-name`}
          className={input}
          value={name}
          maxLength={200}
          autoFocus
          aria-invalid={nameError || undefined}
          aria-describedby={nameError ? `${id}-name-error` : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {nameError && (
          <p id={`${id}-name-error`} className={errorText}>
            {t("editorNameInvalid")}
          </p>
        )}
      </div>
      <CategoryPicker name={`${id}-category`} value={category} onChange={setCategory} />
      <TagInput id={`${id}-tags`} value={tags} onChange={setTags} />
      <div>
        <label htmlFor={`${id}-stay`} className={label}>
          {t("stayMinutes")}
        </label>
        <input id={`${id}-stay`} type="number" min={0} max={1440} step={5} inputMode="numeric" className={`${input} max-w-32`} value={stay} onChange={(e) => setStay(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button type="submit" className={`${btnPrimary} ${btnSm}`}>
          {t("save")}
        </button>
        <button type="button" className={`${btn} ${btnSm}`} onClick={onCancel}>
          {tc("cancel")}
        </button>
      </div>
    </form>
  );
}

"use client";

import type { KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { MAX_TAGS, normaliseTags } from "@rota/trip";
import { hint, input } from "../ui";
import { Icon } from "./icons";

/** Committed tags plus whatever is still being typed: the caller saves `normaliseTags([...tags, draft])`. */
export type TagState = { tags: string[]; draft: string };

/**
 * Free-text tags as removable chips. Enter or a comma turns the typed text into a tag; Backspace in an
 * empty field removes the last one. Tags are normalised as the document stores them (normaliseTags).
 */
export function TagInput({ id, value, onChange }: { id: string; value: TagState; onChange: (next: TagState) => void }) {
  const t = useTranslations("trip");
  const { tags, draft } = value;

  const type = (text: string) => {
    const parts = text.split(",");
    const rest = parts.pop() ?? "";
    onChange({ tags: normaliseTags([...tags, ...parts]), draft: rest });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onChange({ tags: normaliseTags([...tags, draft]), draft: "" });
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange({ tags: tags.slice(0, -1), draft });
    }
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium">
        {t("tags")}
      </label>
      {tags.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag} className="inline-flex h-7 min-w-0 items-center gap-1 rounded-md bg-line-2 pl-2 max-lg:h-11 text-[12.5px] font-medium text-ink-2">
              <span className="min-w-0 [overflow-wrap:anywhere]">{tag}</span>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-md hover:bg-hover max-lg:size-11"
                aria-label={t("removeTag", { tag })}
                onClick={() => onChange({ tags: tags.filter((x) => x !== tag), draft })}
              >
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        className={input}
        value={draft}
        disabled={tags.length >= MAX_TAGS}
        aria-describedby={`${id}-hint`}
        onChange={(e) => type(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      <p id={`${id}-hint`} className={hint}>
        {t("tagsHint")}
      </p>
    </div>
  );
}

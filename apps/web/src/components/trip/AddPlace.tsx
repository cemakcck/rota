"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { btnPrimary, errorText, hint, input } from "../ui";
import type { ListId } from "./plan";
import type { ListChoice } from "./MoveDialog";

/**
 * Adds a place by name to a day or Ideas (spec §5, "by hand": listed, not pinned). Search and adding
 * from the map come later. Disabled once the trip is full (soft caps, spec §10).
 */
export function AddPlace({ lists, full, onAdd }: { lists: ListChoice[]; full: boolean; onAdd: (name: string, to: ListId) => void }) {
  const t = useTranslations("trip");
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(lists[0]?.id ?? null);
  const [error, setError] = useState(false);
  // The chosen day may have been removed meanwhile; then the first list is used.
  const to = lists.some((l) => l.id === target) ? target : (lists[0]?.id ?? null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(true);
      return nameRef.current?.focus();
    }
    onAdd(name, to);
    setName("");
    setError(false);
    nameRef.current?.focus();
  }

  return (
    <form onSubmit={submit} noValidate aria-label={t("addPlace")} className="grid gap-2 px-4 pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor={`${id}-name`} className="mb-1 block text-[13px] font-medium">
            {t("placeName")}
          </label>
          <input
            ref={nameRef}
            id={`${id}-name`}
            className={input}
            value={name}
            maxLength={200}
            disabled={full}
            autoComplete="off"
            aria-invalid={error || undefined}
            aria-describedby={error ? `${id}-error` : full ? `${id}-full` : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-to`} className="mb-1 block text-[13px] font-medium">
            {t("addTo")}
          </label>
          <select
            id={`${id}-to`}
            className="h-10 max-w-48 rounded-lg border border-ink-2 bg-surface px-2 text-[14px]"
            value={to ?? ""}
            disabled={full}
            onChange={(e) => setTarget(e.target.value || null)}
          >
            {lists.map((l) => (
              <option key={l.id ?? ""} value={l.id ?? ""}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={`${btnPrimary} h-10`} disabled={full}>
          {t("add")}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className={errorText}>
          {t("editorNameInvalid")}
        </p>
      )}
      {full && (
        <p id={`${id}-full`} className={hint}>
          <strong className="font-semibold text-ink">{t("full")}</strong> {t("fullHelp")}
        </p>
      )}
    </form>
  );
}

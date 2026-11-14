"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { Category } from "@rota/trip";
import { btnPrimary, errorText, hint } from "../ui";
import type { ListId } from "./plan";
import type { ListChoice } from "./MoveDialog";
import { PlaceSearch } from "./PlaceSearch";

/** What the form adds: a searched place with its coordinates, OSM id and address, or just a name. */
export type AddedPlace = { name: string; category: Category; lat?: number; lng?: number; osmId?: string; address?: string };

/**
 * Adds a place to a day or Ideas (spec §5): picked from search, with its coordinates, OSM id, address
 * and suggested category; or by name (listed, not pinned) when nothing is picked. Disabled once the
 * trip is full (soft caps, spec §10).
 */
export function AddPlace({
  lists,
  full,
  near,
  onAdd,
}: {
  lists: ListChoice[];
  full: boolean;
  /** Search results are biased towards the trip's area. */
  near: { lat: number; lng: number } | null;
  onAdd: (place: AddedPlace, to: ListId) => void;
}) {
  const t = useTranslations("trip");
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(lists[0]?.id ?? null);
  const [error, setError] = useState(false);
  // The chosen day may have been removed meanwhile; then the first list is used.
  const to = lists.some((l) => l.id === target) ? target : (lists[0]?.id ?? null);

  function add(place: AddedPlace) {
    onAdd(place, to);
    setName("");
    setError(false);
    nameRef.current?.focus();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(true);
      return nameRef.current?.focus();
    }
    add({ name, category: "other" });
  }

  return (
    <form onSubmit={submit} noValidate aria-label={t("addPlace")} className="grid gap-2 px-4 pt-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor={`${id}-name`} className="mb-1 block text-[13px] font-medium">
            {t("placeName")}
          </label>
          <PlaceSearch
            id={`${id}-name`}
            label={t("placeName")}
            inputRef={nameRef}
            value={name}
            onValueChange={setName}
            onPick={(r) => add({ name: r.name, category: r.category, lat: r.lat, lng: r.lng, osmId: r.osmId, address: r.label || undefined })}
            near={near}
            disabled={full}
            invalid={error}
            describedBy={error ? `${id}-error` : full ? `${id}-full` : undefined}
            placeholder={t("searchPlaceholder")}
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
        <div>
          {/* Lines the button up with the fields under their labels. */}
          <span aria-hidden="true" className="mb-1 block text-[13px]">
            &nbsp;
          </span>
          <button type="submit" className={`${btnPrimary} h-10`} disabled={full}>
            {t("add")}
          </button>
        </div>
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

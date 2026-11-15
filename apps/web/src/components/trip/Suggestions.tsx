"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { MemberView, PlaceView } from "@rota/trip";
import { btn, btnSm } from "../ui";
import { CategoryIcon } from "./icons";
import { MoveDialog, type ListChoice, type MoveTiming } from "./MoveDialog";
import type { ListId } from "./plan";
import { VoteButtons } from "./VoteButtons";

/** What a member can do with suggestions; absent while the user is unknown (read-only). */
export type SuggestionActions = {
  vote(id: string, value: 1 | -1 | 0): void;
  /** Planned, into `to`: into a day at a time (null: untimed) and with a stay, when given; one step. */
  accept(id: string, to: ListId, timing?: MoveTiming): void;
  dismiss(id: string): void;
  restore(id: string): void;
};

function Who({ place, members }: { place: PlaceView; members: MemberView[] }) {
  const by = members.find((m) => m.id === place.addedBy);
  if (!by) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-ink-2">
      <span aria-hidden="true" className="size-[7px] rounded-full" style={{ background: by.colour }} />
      {by.name}
    </span>
  );
}

/**
 * Places the group is deciding on, best-scored first (the view sorts them), then a collapsible list of
 * dismissed ones that can be restored with their votes. No thresholds: accepting is a person's call.
 */
export function Suggestions({
  suggestions,
  dismissed,
  members,
  userId,
  lists,
  suggest,
  actions,
}: {
  suggestions: PlaceView[];
  dismissed: PlaceView[];
  members: MemberView[];
  userId: string | null;
  /** Where an accepted suggestion can go: the days, then Ideas. */
  lists: ListChoice[];
  /** The time suggested for a place as a day's new last stop ("" when none): accepting into a day asks it first. */
  suggest?: (dayId: string, place: PlaceView) => string;
  actions: SuggestionActions | null;
}) {
  const t = useTranslations("trip");
  const tc = useTranslations("categories");
  const headingId = useId();
  const dismissedId = useId();
  const [accepting, setAccepting] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const target = suggestions.find((p) => p.id === accepting);

  // Someone else accepted or dismissed it while the picker was open: the picker goes with it.
  if (accepting !== null && !target) setAccepting(null);

  // A row's buttons disappear with it; focus goes to the section so it is not lost.
  const keepFocus = () => requestAnimationFrame(() => document.getElementById(headingId)?.focus());

  return (
    <section aria-labelledby={headingId} className="pb-2">
      <div className="px-5 pb-2.5 pt-3.5">
        <h2 id={headingId} tabIndex={-1} className="text-[15px] font-semibold tracking-[-0.01em] outline-none">
          {t("suggestions")}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-ink-2">{t("suggestionsHelp")}</p>
      </div>
      <div className="mx-5">
        {suggestions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-[13px] text-ink-2">{t("suggestionsEmpty")}</p>
        ) : (
          <ul className="grid gap-2">
            {suggestions.map((place) => {
              const name = place.name || t("unnamed");
              return (
                <li key={place.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface p-3">
                  <CategoryIcon category={place.category} label={tc(place.category)} />
                  <div className="min-w-0 flex-1 basis-40">
                    <p data-testid="suggestion-name" className="text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]">
                      {name}
                    </p>
                    <Who place={place} members={members} />
                  </div>
                  <VoteButtons place={place} userId={actions ? userId : null} onVote={(value) => actions?.vote(place.id, value)} />
                  {actions && (
                    <div className="flex gap-1">
                      <button type="button" className={`${btn} ${btnSm}`} aria-label={t("acceptFor", { name })} aria-haspopup="dialog" onClick={() => setAccepting(place.id)}>
                        {t("accept")}
                      </button>
                      <button
                        type="button"
                        className={`${btn} ${btnSm}`}
                        aria-label={t("dismissFor", { name })}
                        onClick={() => {
                          actions.dismiss(place.id);
                          keepFocus();
                        }}
                      >
                        {t("dismiss")}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {dismissed.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={dismissedId}
              className="inline-flex h-9 max-lg:h-11 items-center rounded-lg px-2 text-[13px] font-medium text-ink-2 hover:bg-hover"
              onClick={() => setOpen((o) => !o)}
            >
              {t("dismissedCount", { count: dismissed.length })}
            </button>
            <ul id={dismissedId} hidden={!open} className="mt-1 grid gap-2">
              {dismissed.map((place) => {
                const name = place.name || t("unnamed");
                return (
                  <li key={place.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-line-2 p-3">
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]">{name}</p>
                      <Who place={place} members={members} />
                    </div>
                    <span className="font-mono text-[13px] font-semibold tabular-nums">
                      <span aria-hidden="true">{place.score}</span>
                      <span className="sr-only">{t("score", { score: place.score })}</span>
                    </span>
                    {actions && (
                      <button
                        type="button"
                        className={`${btn} ${btnSm}`}
                        aria-label={t("restoreFor", { name })}
                        onClick={() => {
                          actions.restore(place.id);
                          keepFocus();
                        }}
                      >
                        {t("restore")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {target && actions && (
        <MoveDialog
          place={target}
          accept
          lists={lists}
          when={suggest && { suggest: (dayId) => suggest(dayId, target), stayMinutes: target.stayMinutes }}
          onClose={() => setAccepting(null)}
          onMove={(to, timing) => {
            actions.accept(target.id, to, timing);
            setAccepting(null);
            keepFocus();
          }}
        />
      )}
    </section>
  );
}

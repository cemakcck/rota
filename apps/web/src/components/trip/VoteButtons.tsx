"use client";

import { useTranslations } from "next-intl";
import type { PlaceView } from "@rota/trip";
import { Icon } from "./icons";

const toggle =
  "grid size-8 place-items-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-hover aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white";

/**
 * A suggestion's score with up and down toggles for the signed-in member: pressing the active one
 * withdraws the vote. Without `userId` (read-only) only the score shows.
 */
export function VoteButtons({ place, userId, onVote }: { place: PlaceView; userId: string | null; onVote: (value: 1 | -1 | 0) => void }) {
  const t = useTranslations("trip");
  const name = place.name || t("unnamed");
  const mine = userId === null ? undefined : place.votes[userId];
  const press = (value: 1 | -1) => onVote(mine === value ? 0 : value);
  return (
    <div className="flex items-center gap-1">
      {userId !== null && (
        <button type="button" className={toggle} aria-pressed={mine === 1} aria-label={t("upvote", { name })} onClick={() => press(1)}>
          <Icon name="up" />
        </button>
      )}
      <span className="min-w-6 text-center font-mono text-[13px] font-semibold tabular-nums">
        <span aria-hidden="true">{place.score}</span>
        <span className="sr-only">{t("score", { score: place.score })}</span>
      </span>
      {userId !== null && (
        <button type="button" className={toggle} aria-pressed={mine === -1} aria-label={t("downvote", { name })} onClick={() => press(-1)}>
          <Icon name="down" />
        </button>
      )}
    </div>
  );
}

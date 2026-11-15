"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { TripView } from "@rota/trip";
import { Icon, type IconName } from "./icons";
import { defaultView, sameView, type TripViewState } from "./view";

/** The phone's bottom tabs (spec §6). */
export type PhoneTab = "plan" | "map" | "ideas" | "checklist";
/** A tab's id (focus moves to and from the rail's Ideas and Checklist across a resize). */
export const phoneTabId = (tab: PhoneTab) => `phone-tab-${tab}`;
const TABS: { tab: PhoneTab; icon: IconName }[] = [
  { tab: "plan", icon: "plan" },
  { tab: "map", icon: "map" },
  { tab: "ideas", icon: "idea" },
  { tab: "checklist", icon: "checklist" },
];

/** What the day chips choose: one day, or the whole trip. */
type ChipView = Extract<TripViewState, { kind: "day" } | { kind: "all" }>;
const isChip = (v: TripViewState): v is ChipView => v.kind === "day" || v.kind === "all";

/**
 * The phone's tabs over the trip's view (the `?view=` the rail and the chips also set, so deep links
 * open on their tab): Ideas and Checklist are their views; Plan and Map both show what the chips chose
 * (a day or the whole trip), as the list or as the map. Which of those two is kept here, as screen
 * state (not in the address): it outlives a resize to the desktop layout, which shows both at once, and
 * back. Leaving Ideas or the checklist for Plan or Map goes back to the chips' last choice (the default
 * day if that day is gone).
 */
export function usePhoneTabs(trip: TripView, shown: TripViewState, show: (v: TripViewState) => void): { tab: PhoneTab; choose(tab: PhoneTab): void } {
  const [pane, setPane] = useState<"plan" | "map">("plan");
  const [chosen, setChosen] = useState<ChipView | null>(isChip(shown) ? shown : null);
  if (isChip(shown) && (chosen === null || !sameView(chosen, shown))) setChosen(shown);
  const tab: PhoneTab = isChip(shown) ? pane : shown.kind;

  const chipView = (): ChipView => {
    if (chosen && (chosen.kind === "all" || trip.days.some((d) => d.id === chosen.dayId))) return chosen;
    const fallback = defaultView(trip);
    return isChip(fallback) ? fallback : { kind: "all" };
  };
  return {
    tab,
    choose(next) {
      setPane(next === "map" ? "map" : "plan");
      if (next === "ideas" || next === "checklist") show({ kind: next });
      else if (!isChip(shown)) show(chipView());
    },
  };
}

/** The phone's bottom tabs: Plan · Map · Ideas · Checklist, the current one marked. */
export function PhoneTabs({ tab, onChoose }: { tab: PhoneTab; onChoose(tab: PhoneTab): void }) {
  const t = useTranslations("trip");
  return (
    <nav aria-label={t("phoneTabs")} className="grid shrink-0 grid-cols-4 border-t border-line bg-surface px-1.5 pb-[env(safe-area-inset-bottom)] lg:hidden">
      {TABS.map(({ tab: id, icon }) => (
        <button
          key={id}
          id={phoneTabId(id)}
          type="button"
          aria-current={tab === id ? "true" : undefined}
          onClick={() => onChoose(id)}
          className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-[11.5px] text-ink-2 aria-[current=true]:font-semibold aria-[current=true]:text-ink"
        >
          <Icon name={icon} size={22} />
          {t(id)}
        </button>
      ))}
    </nav>
  );
}

/** The phone's floating ＋: it takes focus to the search. */
export function AddPlaceButton({ onClick }: { onClick(): void }) {
  const t = useTranslations("trip");
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-4 right-4 z-20 inline-flex h-12 items-center gap-1.5 rounded-full bg-ink pl-4 pr-[18px] text-[14px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(0,0,0,.4)] hover:bg-ink-2 lg:hidden"
    >
      <Icon name="plus" size={18} />
      {t("addPlace")}
    </button>
  );
}

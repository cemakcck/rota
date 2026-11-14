"use client";

import type { Leg, TravelMode } from "@rota/trip";
import { TravelLeg } from "./TravelLeg";

/**
 * The dotted line between two stops of a day, with the travel between them ("9 min walk · 700 m", or
 * "≈ …" for a straight-line estimate). Without coordinates there is no travel: just the line.
 */
export function Connector({ leg, mode }: { leg: Leg | null | undefined; mode: TravelMode }) {
  return (
    <li
      data-testid="travel-leg"
      aria-hidden={leg ? undefined : true}
      className="ml-[25px] flex min-h-6 min-w-0 items-center border-l-2 border-dotted border-[#c8c3bb] py-1.5 pl-[22px] text-[12px] text-ink-2"
    >
      {leg && <TravelLeg leg={leg} mode={mode} />}
    </li>
  );
}

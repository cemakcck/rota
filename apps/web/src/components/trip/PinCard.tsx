"use client";

import { Fragment, useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { placeUrl, type PlaceView } from "@rota/trip";
import { btn, btnPrimary } from "../ui";
import { GoogleMapsPin, Icon } from "./icons";
import type { DetailsWhere } from "./PlaceDetails";
import { Approximate, useDuration, useStay } from "./TravelLeg";

/** The id of the pin card's Details button (focus goes back to it when the details close). */
export const PIN_CARD_DETAILS_ID = "pin-card-details";
/** About how much of the map's bottom the card covers (px): fits and selections keep the pins above it. */
export const PIN_CARD_PX = 140;

/**
 * The phone's Map tab: the selected pin's card, pulled up over the bottom of the map (spec §6). Its
 * number in the day's colour, its name, when it is reached, how long it is stayed and the travel to it
 * (arrive · stay · walk), then Google Maps and Details; ✕ puts it away. Ideas have no number or timing.
 */
export function PinCard({ place, where, onDetails, onClose }: { place: PlaceView; where: DetailsWhere; onDetails(): void; onClose(): void }) {
  const t = useTranslations("trip");
  const stay = useStay();
  const duration = useDuration();
  const nameId = useId();
  const name = place.name || t("unnamed");

  const facts: ReactNode[] = [];
  if (where.kind === "day") {
    const arrive = where.timing?.arrive ?? null;
    if (arrive !== null)
      facts.push(
        <>
          {t("arrive")} {where.timing!.estimated && <Approximate />}
          {arrive}
        </>,
      );
    facts.push(t("stayFor", { duration: stay(place.stayMinutes) }));
    if (where.leg)
      facts.push(
        <>
          {where.leg.approximate && <Approximate />}
          {t(where.mode === "walk" ? "legWalk" : "legDrive", { duration: duration(where.leg.seconds) })}
        </>,
      );
  } else facts.push(where.label);

  return (
    <section
      aria-labelledby={nameId}
      className="absolute inset-x-0 bottom-0 z-10 rounded-t-[18px] bg-surface px-4 pb-4 pt-3 shadow-[0_-8px_24px_-10px_rgba(0,0,0,.25)] lg:hidden"
    >
      <div className="flex items-start gap-3">
        {where.kind === "day" && (
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white" style={{ background: where.colour }}>
            {where.number}
          </span>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id={nameId} className="text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">
            {name}
          </h2>
          <p data-testid="pin-card-facts" className="mt-0.5 text-[12.5px] text-ink-2">
            {facts.map((fact, i) => (
              <Fragment key={i}>
                {i > 0 && " · "}
                {fact}
              </Fragment>
            ))}
          </p>
        </div>
        <button type="button" aria-label={t("close")} onClick={onClose} className="-mr-2 -mt-1.5 grid size-11 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink">
          <Icon name="close" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={placeUrl(place)} target="_blank" rel="noopener noreferrer" className={`${btn} !h-11`}>
          <GoogleMapsPin />
          {t("googleMaps")}
          <span className="sr-only">
            {" "}
            — {name} ({t("newTab")})
          </span>
          <Icon name="ext" size={12} className="text-ink-2" />
        </a>
        <button id={PIN_CARD_DETAILS_ID} type="button" onClick={onDetails} className={`${btnPrimary} !h-11`}>
          {t("details")}
        </button>
      </div>
    </section>
  );
}

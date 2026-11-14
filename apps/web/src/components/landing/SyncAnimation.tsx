import { useTranslations } from "next-intl";
import { Avatar } from "../Avatar";

/** Two windows on the same itinerary: the third place lands on one, then on the other. Static when motion is reduced (globals.css). */
export function SyncAnimation() {
  const t = useTranslations("landing");
  const places = [t("placeOne"), t("placeTwo"), t("placeThree")];
  const windows = [
    { who: t("windowYou"), colour: "#2563eb", late: false },
    { who: t("windowFriend"), colour: "#ea580c", late: true },
  ];
  return (
    <div role="img" aria-label={t("animationLabel")} className="grid grid-cols-2 gap-3">
      {windows.map((w) => (
        <div key={w.who} aria-hidden="true" className="rounded-2xl border border-line bg-surface p-3 shadow-2">
          <div className="mb-3 flex items-center gap-2">
            <Avatar name={w.who} colour={w.colour} size={22} />
            <span className="text-[12.5px] font-semibold">{w.who}</span>
          </div>
          <ul className="grid gap-2">
            {places.map((place, i) => (
              <li
                key={place}
                className={`flex items-center gap-2 rounded-lg border border-line bg-paper px-2 py-2 text-[12.5px] ${i === 2 ? `rota-appear ${w.late ? "rota-appear-late" : ""}` : ""}`}
              >
                <span className="grid size-5 place-items-center rounded-full bg-ink font-mono text-[10px] font-semibold text-white">{i + 1}</span>
                {place}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

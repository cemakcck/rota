import * as Y from "yjs";
import type { Category } from "./categories";
import {
  addChecklistItem,
  addPlace,
  dayNote,
  initTrip,
  placeNote,
  setDay,
  updateChecklistItem,
  upsertMember,
  vote,
} from "./doc";
import type { Locale, MemberView } from "./schema";

export type DemoSeedInput = {
  /** Today's date (YYYY-MM-DD) where the visitor is, so the trip is always a week or more ahead. */
  today: string;
  locale: Locale;
  owner: MemberView;
  deniz: MemberView;
  selin: MemberView;
};

const DAY_MS = 86_400_000;
const FRIDAY = 5;

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** First Friday on or after `today` + 7 days (calendar arithmetic in UTC, so the machine's zone never matters). */
export function demoStartDate(today: string): string {
  const earliest = addDays(today, 7);
  const weekday = new Date(`${earliest}T00:00:00Z`).getUTCDay();
  return addDays(earliest, (FRIDAY - weekday + 7) % 7);
}

type Day = 0 | 1 | 2;
type SeedPlace = {
  name: string;
  /** OpenStreetMap element id (n/w/r + number), so the app can fetch its opening hours. */
  osmId?: string;
  lat: number;
  lng: number;
  category: Category;
  tags?: string[];
  stay?: number;
  by: "owner" | "deniz" | "selin";
  day: Day | null;
  /** The time set for the stop ("HH:MM"); none = untimed, shown as an estimate after the stop before. */
  time?: string;
  note?: { en: string; tr: string };
};

// Real venues and landmarks; coordinates are approximate, which is enough for a map pin.
// Most stops have a set time; a few are left untimed between them, so the demo shows estimates too.
const PLACES: SeedPlace[] = [
  // Day 1: Karaköy and Galata, on foot
  { name: "Karaköy Güllüoğlu", osmId: "n4548658690", lat: 41.0226, lng: 28.9776, category: "food", tags: ["breakfast", "baklava"], stay: 45, by: "owner", day: 0, time: "08:30",
    note: { en: "Baklava by weight. Get the pistachio one and a tea.", tr: "Baklava kilo ile. Antep fıstıklısını bir çayla al." } },
  { name: "Istanbul Modern", lat: 41.0266, lng: 28.9757, category: "museum", stay: 120, by: "deniz", day: 0, time: "10:15" },
  { name: "Karaköy Lokantası", lat: 41.0239, lng: 28.9774, category: "food", tags: ["lunch"], stay: 75, by: "owner", day: 0, time: "13:00" },
  { name: "Galata Tower", osmId: "w23236783", lat: 41.0256, lng: 28.9744, category: "sight", tags: ["views"], stay: 60, by: "selin", day: 0,
    note: { en: "Queue is shortest right at opening or around sunset.", tr: "Sıra en az açılışta ve gün batımına doğru." } },
  // Day 2: Balat and the old city, then a taxi up the Bosphorus
  { name: "Forno Balat", lat: 41.0292, lng: 28.9478, category: "cafe", tags: ["breakfast", "pastry"], stay: 45, by: "selin", day: 1, time: "09:00" },
  { name: "Balat colourful streets", lat: 41.0297, lng: 28.9489, category: "sight", tags: ["photos", "walk"], stay: 90, by: "deniz", day: 1,
    note: { en: "Best light before 11. Steep cobbles, wear proper shoes.", tr: "11'den önce ışık en güzel. Yokuşlu arnavut kaldırımı, rahat ayakkabı giy." } },
  { name: "Chora Church", osmId: "r7614527", lat: 41.0316, lng: 28.9391, category: "museum", tags: ["mosaics"], stay: 75, by: "owner", day: 1, time: "11:45" },
  // Set late enough that the visit runs past closing: the demo's opening-hours warning.
  { name: "Rumeli Hisarı", osmId: "r7318154", lat: 41.0849, lng: 29.0561, category: "museum", tags: ["fortress", "views"], stay: 90, by: "owner", day: 1, time: "15:45",
    note: { en: "Closes at 17:00. It is a long way from Balat, so go by taxi or the ferry-and-bus combo.", tr: "17:00'de kapanıyor. Balat'tan uzak, taksiyle ya da vapur ve otobüsle git." } },
  // Day 3: Bosphorus shore and Kadıköy, by taxi
  { name: "Emirgan Park", lat: 41.1087, lng: 29.0556, category: "nature", tags: ["walk"], stay: 90, by: "selin", day: 2, time: "10:00" },
  { name: "Çiya Sofrası", lat: 40.9904, lng: 29.0243, category: "food", tags: ["lunch", "regional"], stay: 90, by: "deniz", day: 2, time: "12:30" },
  { name: "Kadıköy Çarşı", lat: 40.9905, lng: 29.0237, category: "shopping", tags: ["market"], stay: 60, by: "owner", day: 2 },
  { name: "Kadıköy Barlar Sokağı", lat: 40.9886, lng: 29.0272, category: "drinks", tags: ["evening"], stay: 90, by: "selin", day: 2, time: "19:00" },
  // Suggestions
  { name: "Moda Sahil", lat: 40.9822, lng: 29.0252, category: "nature", tags: ["sunset"], by: "deniz", day: null },
  { name: "Pierre Loti Hill", lat: 41.0546, lng: 28.9338, category: "sight", tags: ["views", "tea"], by: "selin", day: null },
];

function writeNote(fragment: Y.XmlFragment, text: string): void {
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  fragment.insert(0, [paragraph]);
}

/**
 * Fills an empty document with the Istanbul long weekend: 12 planned places over 3 days, 2
 * suggestions the friends have voted on, and a part-done checklist. Every edit is attributed to the
 * member who "made" it.
 */
export function seedDemoTrip(doc: Y.Doc, input: DemoSeedInput): void {
  const { locale, owner, deniz, selin } = input;
  const t = (en: string, tr: string) => (locale === "tr" ? tr : en);
  const who = { owner, deniz, selin };

  initTrip(
    doc,
    {
      name: t("Istanbul long weekend", "İstanbul'da uzun hafta sonu"),
      startDate: demoStartDate(input.today),
      days: 3,
      destination: { name: "Istanbul", lat: 41.0082, lng: 28.9784 },
      isDemo: true,
      locale,
    },
    owner.id,
  );
  for (const member of [owner, deniz, selin]) upsertMember(doc, member);

  const dayIds = doc.getMap<Y.Map<unknown>>("days");
  const orderedDays = [...dayIds.entries()].sort((a, b) => (a[1].get("index") as number) - (b[1].get("index") as number)).map(([id]) => id);
  setDay(doc, orderedDays[0], { title: t("Karaköy & Galata", "Karaköy ve Galata") }, owner.id);
  // Days 2 and 3 cross the city: by car.
  setDay(doc, orderedDays[1], { travelMode: "drive", title: t("Balat & the old city", "Balat ve tarihi yarımada") }, owner.id);
  setDay(doc, orderedDays[2], { travelMode: "drive", title: t("Bosphorus & Kadıköy", "Boğaz ve Kadıköy") }, owner.id);

  for (const p of PLACES) {
    const by = who[p.by].id;
    const id = addPlace(
      doc,
      {
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        osmId: p.osmId,
        category: p.category,
        tags: p.tags,
        stayMinutes: p.stay,
        time: p.time ?? null,
        dayId: p.day === null ? null : orderedDays[p.day],
        status: p.day === null ? "suggested" : "planned",
      },
      by,
    );
    if (p.note) doc.transact(() => writeNote(placeNote(doc, id), t(p.note!.en, p.note!.tr)), by);
    if (p.day === null) {
      // Both friends vote on each suggestion; they agree on Moda Sahil and split on Pierre Loti Hill.
      vote(doc, id, deniz.id, 1);
      vote(doc, id, selin.id, p.name === "Moda Sahil" ? 1 : -1);
    }
  }

  doc.transact(
    () => writeNote(dayNote(doc, orderedDays[0]), t("Karaköy and Galata on foot. Everything is within a 15 minute walk, so no taxis today.", "Karaköy ve Galata yürüyerek. Hepsi 15 dakikalık mesafede, bugün taksi yok.")),
    owner.id,
  );

  const first = addChecklistItem(doc, t("Buy Istanbulkart passes", "İstanbulkart al"), owner.id);
  const second = addChecklistItem(doc, t("Download offline maps", "Çevrimdışı haritaları indir"), deniz.id);
  addChecklistItem(doc, t("Book a table at Çiya Sofrası", "Çiya Sofrası için masa ayırt"), selin.id);
  const fourth = addChecklistItem(doc, t("Check Chora Church opening hours", "Kariye Camii saatlerine bak"), owner.id);
  addChecklistItem(doc, t("Pack comfortable walking shoes", "Rahat yürüyüş ayakkabısı al"), selin.id);
  updateChecklistItem(doc, first, { done: true }, owner.id);
  updateChecklistItem(doc, second, { done: true }, deniz.id);
  updateChecklistItem(doc, fourth, { assignee: deniz.id }, owner.id);
}

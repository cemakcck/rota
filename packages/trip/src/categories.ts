export const CATEGORIES = [
  "food",
  "drinks",
  "cafe",
  "museum",
  "sight",
  "nightlife",
  "shopping",
  "nature",
  "gym",
  "stay",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const DEFAULT_STAY_MINUTES: Record<Category, number> = {
  food: 75,
  drinks: 60,
  cafe: 45,
  museum: 120,
  sight: 45,
  nightlife: 120,
  shopping: 60,
  nature: 90,
  gym: 60,
  stay: 0,
  other: 60,
};

export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 24;

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** Trim, drop empties, truncate to 24 chars, dedupe case-insensitively (first wins), keep at most 5. */
export function normaliseTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH).trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

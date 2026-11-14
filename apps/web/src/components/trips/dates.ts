const DAY_MS = 86_400_000;

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

type Dated = { startDate: string; days: number };

/** Upcoming (or running) trips by start date, then past ones, most recent first. */
export function splitTrips<T extends Dated>(list: T[], today: string): { upcoming: T[]; past: T[] } {
  const ends = (t: T) => addDays(t.startDate, t.days - 1);
  return {
    upcoming: list.filter((t) => ends(t) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate)),
    past: list.filter((t) => ends(t) < today).sort((a, b) => b.startDate.localeCompare(a.startDate)),
  };
}

/** "4 – 6 Dec 2026" in the locale; the dates are calendar days, so they are formatted in UTC. */
export function formatRange(locale: string, startDate: string, days: number): string {
  const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return format.formatRange(new Date(`${startDate}T00:00:00Z`), new Date(`${addDays(startDate, days - 1)}T00:00:00Z`));
}

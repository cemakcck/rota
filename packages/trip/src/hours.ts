import opening_hours from "opening_hours";

export type HoursWarning = { kind: "closed-day" | "opens-later" | "closes-before"; at?: string };

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A Date from local wall-clock strings; identical under any TZ. */
function local(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, hh, mm);
}

/**
 * Compares a stay (arrive..leave on `date`) with OSM opening hours. Returns
 * null when it fits, or when the hours cannot be parsed or are uncertain. The
 * result carries no text; callers format it for the locale.
 */
export function hoursWarning(
  openingHours: string,
  date: string,
  arrive: string,
  leave: string,
  locale: "en" | "tr",
): HoursWarning | null {
  void locale;
  let oh: opening_hours;
  try {
    oh = new opening_hours(openingHours);
  } catch {
    return null;
  }
  const from = local(date, arrive);
  let to = local(date, leave);
  if (to <= from) to = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1, to.getHours(), to.getMinutes());
  const dayStart = local(date, "00:00");
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 2);
  let intervals: [Date, Date, boolean, string | undefined][];
  try {
    intervals = oh.getOpenIntervals(dayStart, dayEnd);
  } catch {
    return null;
  }
  // Only intervals that begin today matter; the window runs to the end of
  // tomorrow so one that crosses midnight is not cut short.
  const nextMidnight = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  const today = intervals.filter((i) => i[0] < nextMidnight);
  if (today.some((i) => i[2])) return null;
  if (today.length === 0) return { kind: "closed-day" };

  const containing = today.find((i) => i[0] <= from && from < i[1]);
  if (containing) {
    return containing[1] < to ? { kind: "closes-before", at: clock(containing[1]) } : null;
  }
  const next = today.find((i) => i[0] > from);
  if (next) return { kind: "opens-later", at: clock(next[0]) };
  return { kind: "closes-before", at: clock(today[today.length - 1][1]) };
}

/**
 * Whether a place with these opening hours does not open at all on `date` (the "closed-day" warning),
 * which needs no time: so an untimed stop can still be warned. False when unparseable or uncertain.
 */
export function closedAllDay(openingHours: string, date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return hoursWarning(openingHours, date, "00:00", "23:59", "en")?.kind === "closed-day";
}

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
  if (intervals.some((i) => i[2])) return null;
  const dayOnly = intervals.filter((i) => i[0] < new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1));
  if (dayOnly.length === 0) return { kind: "closed-day" };

  const containing = intervals.find((i) => i[0] <= from && from < i[1]);
  if (containing) {
    return containing[1] < to ? { kind: "closes-before", at: clock(containing[1]) } : null;
  }
  const next = intervals.find((i) => i[0] > from);
  if (next) return { kind: "opens-later", at: clock(next[0]) };
  const last = intervals[intervals.length - 1];
  return { kind: "closes-before", at: clock(last[1]) };
}

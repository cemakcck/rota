import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { dayTimeline, estimateLeg, hoursWarning, readTrip } from "../src";
import { seedDemoTrip } from "../src/seed";

const owner = { id: "u-owner", name: "Guest Otter", colour: "#2563eb" };
const deniz = { id: "u-deniz", name: "Deniz", colour: "#ea580c" };
const selin = { id: "u-selin", name: "Selin", colour: "#0d9488" };

function seeded(today = "2026-11-14", locale: "en" | "tr" = "en") {
  const doc = new Y.Doc();
  seedDemoTrip(doc, { today, locale, owner, deniz, selin });
  return { doc, view: readTrip(doc) };
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

describe("seedDemoTrip", () => {
  it("has 12 planned places over 3 days, 2 suggestions, a 5-item checklist and 3 members", () => {
    const { view } = seeded();
    expect(view.name).toBe("Istanbul long weekend");
    expect(view.isDemo).toBe(true);
    expect(view.destination).toEqual({ name: "Istanbul", lat: 41.0082, lng: 28.9784 });
    expect(view.days).toHaveLength(3);
    expect(view.days.flatMap((d) => d.places)).toHaveLength(12);
    expect(view.ideas).toHaveLength(0);
    expect(view.suggestions).toHaveLength(2);
    expect(view.checklist).toHaveLength(5);
    expect(view.members.map((m) => m.id).sort()).toEqual([deniz.id, owner.id, selin.id].sort());
    expect(view.days[0].startTime).toBe("09:30");
  });

  it("is lived in: categories, tags, notes, votes, checklist state and spread authorship", () => {
    const { doc, view } = seeded();
    const planned = view.days.flatMap((d) => d.places);
    const categories = new Set(planned.map((p) => p.category));
    for (const c of ["food", "drinks", "cafe", "museum", "sight", "nature", "shopping"]) expect(categories).toContain(c);
    expect(planned.filter((p) => p.tags.length > 0).length).toBeGreaterThanOrEqual(4);
    expect(new Set(planned.map((p) => p.addedBy)).size).toBe(3);
    expect(planned.every((p) => p.stayMinutes > 0)).toBe(true);

    const withNote = planned.filter((p) => doc.getMap<Y.Map<unknown>>("places").get(p.id)!.get("note") instanceof Y.XmlFragment && (doc.getMap<Y.Map<unknown>>("places").get(p.id)!.get("note") as Y.XmlFragment).length > 0);
    expect(withNote.length).toBeGreaterThanOrEqual(3);
    const dayNote = doc.getMap<Y.Map<unknown>>("days").get(view.days[0].id)!.get("note") as Y.XmlFragment;
    expect(dayNote.toString()).toContain("Karaköy");

    for (const s of view.suggestions) {
      expect(s.votes[deniz.id] ?? s.votes[selin.id]).toBeDefined();
    }
    expect(view.suggestions.some((s) => s.votes[deniz.id] && s.votes[selin.id])).toBe(true);
    expect(view.checklist.filter((i) => i.done)).toHaveLength(2);
    expect(view.checklist.filter((i) => i.assignee === deniz.id)).toHaveLength(1);
  });

  it("all coordinates are inside Istanbul (40.8–41.3 N, 28.6–29.4 E)", () => {
    const { view } = seeded();
    const all = [...view.days.flatMap((d) => d.places), ...view.suggestions];
    for (const p of all) {
      expect(p.lat).toBeGreaterThan(40.8);
      expect(p.lat).toBeLessThan(41.3);
      expect(p.lng).toBeGreaterThan(28.6);
      expect(p.lng).toBeLessThan(29.4);
    }
  });

  it("start date is a Friday at least 7 days after today", () => {
    for (const today of ["2026-11-14", "2026-11-20", "2026-11-21", "2027-02-28", "2026-12-31"]) {
      const { view } = seeded(today);
      expect(weekday(view.startDate)).toBe(5);
      expect(daysBetween(today, view.startDate)).toBeGreaterThanOrEqual(7);
      expect(daysBetween(today, view.startDate)).toBeLessThan(14);
    }
    expect(seeded("2026-11-14").view.startDate).toBe("2026-11-27");
    expect(seeded("2026-11-20").view.startDate).toBe("2026-11-27");
  });

  it("Turkish locale gets the Turkish trip name", () => {
    const { view } = seeded("2026-11-14", "tr");
    expect(view.name).toBe("İstanbul'da uzun hafta sonu");
    expect(view.locale).toBe("tr");
  });

  // opening_hours values read from OpenStreetMap on 2026-11-14 (see the task 7 report).
  const OSM_HOURS: Record<string, string> = {
    n4548658690: "Mo-Sa 07:30-01:00; Su 08:00-01:00", // Karaköy Güllüoğlu
    w23236783: "09:00-20:30", // Galata Tower
    r7614527: "09:00-18:00", // Kariye Camii (Chora)
    r7318154: "Th-Tu 09:00-17:00", // Rumeli Hisarı
  };

  it("real OSM ids on well-known venues, and at least one stop that triggers an opening-hours warning", () => {
    const { view } = seeded();
    const planned = view.days.flatMap((d) => d.places);
    const withOsm = planned.filter((p) => p.osmId !== null);
    expect(withOsm.length).toBeGreaterThanOrEqual(3);
    for (const p of withOsm) expect(Object.keys(OSM_HOURS)).toContain(p.osmId);

    const warnings: string[] = [];
    for (const day of view.days) {
      const legs = day.places.slice(1).map((p, i) => estimateLeg(day.places[i] as { lat: number; lng: number }, p as { lat: number; lng: number }, day.travelMode));
      dayTimeline(day, legs).forEach((entry, i) => {
        const hours = OSM_HOURS[day.places[i].osmId ?? ""];
        if (!hours) return;
        const w = hoursWarning(hours, day.date, entry.arrive, entry.leave, "en");
        if (w) warnings.push(`${day.places[i].name}:${w.kind}`);
      });
    }
    expect(warnings).toEqual(["Rumeli Hisarı:closes-before"]);
  });
});

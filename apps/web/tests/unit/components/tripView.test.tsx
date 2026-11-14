import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as Y from "yjs";
import { addChecklistItem, addPlace, dayNote, readTrip, removeDay, setDay, setTripMeta, updateChecklistItem } from "@rota/trip";
import { dropTarget } from "@/components/trip/plan";
import { renderIntl, stubFetch } from "./helpers";
import { fake, newTrip, refresh, remoteEdit, useFakeTrip } from "./tripHarness";

vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/authClient", async (original) => ({
  ...(await original<object>()),
  useUserId: () => fake.userId,
  useUserState: () => ({ userId: fake.userId, signedOut: false }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { TripScreen } from "@/components/trip/TripScreen";

const deniz = { id: "u2", name: "Deniz", colour: "#ea580c" };

/** Screens of the given width for `(min-width: …)` queries. */
function screenWidth(px: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? NaN);
    return { matches: px >= min, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
}

const rail = () => screen.getByRole("navigation", { name: "Trip" });
const dayButton = (n: number) => within(rail()).getByRole("button", { name: new RegExp(`^Day ${n} · `) });
const at = (search: string) => window.history.replaceState(null, "", `/en/t/t1${search}`);

beforeEach(() => {
  screenWidth(1280);
  at("");
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  at("");
});

describe("trip view", () => {
  it("view defaults to the first day", () => {
    newTrip({ days: 3 });
    renderIntl(<TripScreen tripId="t1" />);
    expect(dayButton(1).getAttribute("aria-current")).toBe("true");
    expect(dayButton(2).getAttribute("aria-current")).toBeNull();
    expect(window.location.search).toBe("");
    cleanup();

    // While the trip is on, today's day.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 28, 10, 0));
    renderIntl(<TripScreen tripId="t1" />);
    expect(dayButton(2).getAttribute("aria-current")).toBe("true");
    expect(dayButton(1).getAttribute("aria-current")).toBeNull();
  });

  it("view follows the URL and writes it on change", () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Balat", category: "sight", dayId: dayIds[1] }, "u1");
    at(`?view=day&day=${dayIds[1]}`);
    const before = window.history.length;
    renderIntl(<TripScreen tripId="t1" />);
    expect(dayButton(2).getAttribute("aria-current")).toBe("true");
    // The list shows the selected day only.
    expect(screen.getByText("Balat")).toBeTruthy();
    expect(screen.queryByText("Galata Tower")).toBeNull();

    fireEvent.click(within(rail()).getByRole("button", { name: /^Ideas & votes/ }));
    expect(window.location.search).toBe("?view=ideas");
    fireEvent.click(within(rail()).getByRole("button", { name: /^Checklist/ }));
    expect(window.location.search).toBe("?view=checklist");
    expect(screen.getByRole("textbox", { name: "New item" })).toBeTruthy();
    fireEvent.click(within(rail()).getByRole("button", { name: "Whole trip on map" }));
    expect(window.location.search).toBe("?view=all");
    expect(screen.getByText("Balat")).toBeTruthy();
    expect(screen.getByText("Galata Tower")).toBeTruthy();
    fireEvent.click(dayButton(1));
    expect(window.location.search).toBe(`?view=day&day=${dayIds[0]}`);
    expect(dayButton(1).getAttribute("aria-current")).toBe("true");
    // Replaced, not pushed: no history spam.
    expect(window.history.length).toBe(before);

    // Back/forward (or any outside change of the address) is followed.
    act(() => {
      at(`?view=day&day=${dayIds[2]}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(dayButton(3).getAttribute("aria-current")).toBe("true");
  });

  it("view falls back when its day is removed remotely", () => {
    const { dayIds } = newTrip({ days: 3 });
    at(`?view=day&day=${dayIds[1]}`);
    renderIntl(<TripScreen tripId="t1" />);
    expect(dayButton(2).getAttribute("aria-current")).toBe("true");

    remoteEdit("u2", (doc, as) => removeDay(doc, dayIds[1], as));
    // The day that took its place (the old Day 3, now Day 2) is shown, and the address says so.
    expect(within(rail()).getAllByRole("button", { name: /^Day \d · / })).toHaveLength(2);
    expect(dayButton(2).getAttribute("aria-current")).toBe("true");
    expect(window.location.search).toBe(`?view=day&day=${dayIds[2]}`);

    // The last day removed: the nearest remaining one.
    remoteEdit("u2", (doc, as) => removeDay(doc, dayIds[2], as));
    expect(dayButton(1).getAttribute("aria-current")).toBe("true");
    expect(window.location.search).toBe(`?view=day&day=${dayIds[0]}`);

    // No days left: Ideas.
    remoteEdit("u2", (doc, as) => removeDay(doc, dayIds[0], as));
    expect(
      within(rail())
        .getByRole("button", { name: /^Ideas & votes/ })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(window.location.search).toBe("?view=ideas");
  });

  it("a deep link to a day survives the trip loading", () => {
    const { dayIds } = newTrip({ days: 3 });
    const loaded = fake.view;
    at(`?view=day&day=${dayIds[1]}`);
    // Before the local copy is read: no days yet.
    fake.ready = false;
    fake.view = readTrip(new Y.Doc());
    renderIntl(<TripScreen tripId="t1" />);
    expect(window.location.search).toBe(`?view=day&day=${dayIds[1]}`);

    fake.view = loaded;
    fake.ready = true;
    refresh();
    expect(dayButton(2).getAttribute("aria-current")).toBe("true");
    expect(window.location.search).toBe(`?view=day&day=${dayIds[1]}`);
  });

  it("a drop on a rail day that is gone does nothing", () => {
    const { doc, dayIds } = newTrip({ days: 2 });
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    expect(dropTarget(fake.view, id, `rail:day:${dayIds[1]}`)).toEqual({ dayId: dayIds[1] });
    expect(dropTarget(fake.view, id, "rail:ideas")).toEqual({ dayId: null });
    removeDay(doc, dayIds[1], "u2");
    expect(dropTarget(fake.view, id, `rail:day:${dayIds[1]}`)).toBeNull();
  });

  it("rail shows each day with colour, date and its title (else its stop count) and marks the selected one", () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    addPlace(doc, { name: "Karaköy Güllüoğlu", category: "food", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Balat", category: "sight", dayId: dayIds[1] }, "u1");
    setDay(doc, dayIds[0], { title: "Karaköy & Galata" }, "u1");
    // The day's note is not the rail's summary.
    doc.transact(() => {
      const p = new Y.XmlElement("paragraph");
      p.insert(0, [new Y.XmlText("Not on the rail")]);
      dayNote(doc, dayIds[1]).insert(0, [p]);
    }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    const days = within(rail()).getAllByRole("button", { name: /^Day \d · / });
    expect(days.map((d) => d.textContent)).toEqual(["Day 1 · Fri 27Karaköy & Galata", "Day 2 · Sat 281 stop", "Day 3 · Sun 29No stops yet"]);
    const swatches = days.map((d) => (d.querySelector("[data-day-colour]") as HTMLElement).style.backgroundColor);
    expect(swatches).toEqual(["rgb(30, 58, 138)", "rgb(159, 18, 57)", "rgb(22, 101, 52)"]);
    expect(days.map((d) => d.getAttribute("aria-current"))).toEqual(["true", null, null]);

    fireEvent.click(days[2]);
    expect(dayButton(3).getAttribute("aria-current")).toBe("true");
    expect(dayButton(1).getAttribute("aria-current")).toBeNull();
    // Each entry is a drop target for dragged rows.
    expect(dayButton(1).getAttribute("data-drop")).toBe(`rail:day:${dayIds[0]}`);
    expect(
      within(rail())
        .getByRole("button", { name: /^Ideas & votes/ })
        .getAttribute("data-drop"),
    ).toBe("rail:ideas");
  });

  it("rail counts ideas+suggestions and checklist done/total", () => {
    const { doc } = newTrip();
    addPlace(doc, { name: "Pierre Loti", category: "sight", dayId: null }, "u1");
    addPlace(doc, { name: "Çiya", category: "food", dayId: null, status: "suggested" }, "u2");
    addPlace(doc, { name: "Moda", category: "nature", dayId: null, status: "suggested" }, "u2");
    const a = addChecklistItem(doc, "Museum pass", "u1");
    addChecklistItem(doc, "Istanbulkart", "u1");
    addChecklistItem(doc, "Book dinner", "u1");
    updateChecklistItem(doc, a, { done: true }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    const ideas = within(rail()).getByRole("button", { name: "Ideas & votes, 3" });
    expect(ideas.textContent).toBe("Ideas & votes3");
    const checklist = within(rail()).getByRole("button", { name: "Checklist, 1 of 3 done" });
    expect(checklist.textContent).toBe("Checklist1/3");

    fireEvent.click(ideas);
    expect(screen.getByText("Pierre Loti")).toBeTruthy();
    expect(screen.getByText("Çiya")).toBeTruthy();
  });

  it("header shows name, dates·days·places, weather chips, sync pill, avatars, Share opens the people sheet", async () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    setTripMeta(doc, { destination: { name: "Istanbul", lat: 41.01, lng: 28.98 } }, "seed");
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Balat", category: "sight", dayId: dayIds[1] }, "u1");
    addPlace(doc, { name: "Pierre Loti", category: "sight", dayId: null }, "u1");
    const trip = {
      id: "t1",
      name: "Istanbul long weekend",
      startDate: "2026-11-27",
      days: 3,
      role: "owner",
      members: [{ id: "u1", name: "Ann", colour: "#2563eb", role: "owner" }],
    };
    const { fn } = stubFetch({
      "GET /api/weather?lat=41.01&lng=28.98&start=2026-11-27&end=2026-11-29": () => ({
        body: {
          days: [
            { date: "2026-11-27", code: 0, max: 17, min: 9, rain: null },
            { date: "2026-11-28", code: 3, max: 14, min: 8, rain: null },
          ],
          availableFrom: null,
        },
      }),
      "GET /api/trips/t1": () => ({ body: trip }),
      "GET /api/trips/t1/invites": () => ({ body: [] }),
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { level: 1, name: "Istanbul long weekend" })).toBeTruthy();
    expect(within(header).getByText("Fri, Nov 27 – Sun, Nov 29 · 3 days · 2 places")).toBeTruthy();
    const weather = await within(header).findByRole("group", { name: "Weather" });
    // Shown on every desktop width (from 1024 px).
    expect(weather.className).toMatch(/(^| )lg:flex( |$)/);
    expect(
      within(weather)
        .getAllByRole("img")
        .map((c) => c.getAttribute("aria-label")),
    ).toEqual(["Fri: Clear, high 17°, low 9°", "Sat: Cloudy, high 14°, low 8°"]);
    expect(within(header).getByText("Synced")).toBeTruthy();
    expect(within(within(header).getByRole("list", { name: "In this trip now" })).getByRole("img", { name: /Ann/ })).toBeTruthy();

    fireEvent.click(within(header).getByRole("button", { name: "Share" }));
    const dialog = await screen.findByRole("dialog", { name: "People" });
    expect(await within(dialog).findByRole("heading", { name: "Members" })).toBeTruthy();
    expect(await within(dialog).findByRole("heading", { name: "Invite people" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(within(header).getByRole("button", { name: "Share" }));
  });

  it('demo box shows friend/offline controls only on demo trips and "You\'re Deniz…" in friend windows', () => {
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(rail()).queryByRole("region", { name: "Demo" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Simulate offline" })).toBeNull();
    cleanup();

    const { doc } = newTrip();
    setTripMeta(doc, { isDemo: true }, "seed");
    renderIntl(<TripScreen tripId="t1" />);
    const box = within(rail()).getByRole("region", { name: "Demo" });
    expect(box.textContent).toContain("Demo trip");
    expect(within(box).getByRole("switch", { name: "Simulate offline" })).toBeTruthy();
    expect(within(box).getByRole("button", { name: "Try it with a friend" })).toBeTruthy();
    expect(within(box).getByRole("button", { name: "Side by side" })).toBeTruthy();
    cleanup();

    at("?friend=1");
    sessionStorage.setItem("rota.friend", JSON.stringify({ token: "tok-deniz", user: deniz }));
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(rail()).getByText("You're Deniz in this window")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Simulate offline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try it with a friend" })).toBeNull();
  });
});

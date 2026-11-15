import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addPlace, movePlace, readTrip, setDay, setPlaceTime, updatePlace, vote } from "@rota/trip";
import { dayDropTarget, dropTarget, railDayDragId } from "@/components/trip/plan";
import { renderIntl, stubFetch } from "./helpers";
import { fake, newTrip, remoteEdit, useFakeTrip } from "./tripHarness";

vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/myTrips", () => ({ forgetTrip: vi.fn(async () => undefined) }));
vi.mock("@/client/authClient", () => ({
  useUserId: () => fake.userId,
  useUserState: () => ({ userId: fake.userId, signedOut: false }),
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { TripScreen } from "@/components/trip/TripScreen";

const at = (search: string) => window.history.replaceState(null, "", `/en/t/t1${search}`);
beforeEach(() => at(""));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  at("");
});

const rail = () => screen.getByRole("navigation", { name: "Trip" });
const railDays = () => within(rail()).getAllByRole("button", { name: /^Day \d · / });
const railLabels = () => railDays().map((d) => d.querySelector("span")!.textContent);
const menu = (n: number) => within(rail()).getByRole("button", { name: `Day ${n} options` });
const openMenu = (n: number) => {
  fireEvent.click(menu(n));
  return within(rail()).getByRole("group", { name: `Day ${n} options` });
};
const day = (n: number) => screen.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) });
const names = (region: HTMLElement) => within(region).queryAllByTestId("place-name").map((e) => e.textContent);
const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
const openDetails = (name: string) => fireEvent.click(within(row(name)).getByRole("button", { name }));
const toastText = () => document.querySelector("[data-action-toast] [role=status]")?.textContent;
const frame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(null))));

describe("days in the rail", () => {
  it("the ⋯ menu moves a day up and down; the dates follow, focus stays on the button used, and it is said", async () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    setDay(doc, dayIds[2], { title: "Balat" }, "u1");
    addPlace(doc, { name: "Fener", category: "sight", dayId: dayIds[2] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    expect(railLabels()).toEqual(["Day 1 · Fri 27", "Day 2 · Sat 28", "Day 3 · Sun 29"]);

    const group = openMenu(3);
    expect(menu(3).getAttribute("aria-expanded")).toBe("true");
    // At the end: Move down stays focusable but does nothing.
    const down = within(group).getByRole("button", { name: "Move down" });
    expect(down.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(down);
    expect(readTrip(doc).days.map((d) => d.id)).toEqual(dayIds);

    const up = within(group).getByRole("button", { name: "Move up" });
    up.focus();
    fireEvent.click(up);
    expect(readTrip(doc).days.map((d) => d.id)).toEqual([dayIds[0], dayIds[2], dayIds[1]]);
    // Balat is now Day 2, on Sat 28; its stop went with it.
    expect(railDays()[1].textContent).toBe("Day 2 · Sat 28Balat");
    expect(readTrip(doc).days[1].places.map((p) => p.name)).toEqual(["Fener"]);
    // Said once, by an Undo toast (the rail has no status of its own); focus stays on Move up.
    expect(within(rail()).queryByRole("status")).toBeNull();
    expect(toastText()).toBe("Balat is now Day 2, Sat, Nov 28");
    expect(screen.getByRole("button", { name: "Undo moving Balat" })).toBeTruthy();
    await frame();
    expect(document.activeElement).toBe(up);

    // Still open: once more to the top.
    fireEvent.click(within(rail()).getByRole("group", { name: "Day 2 options" }).querySelector("button")!);
    expect(readTrip(doc).days.map((d) => d.id)).toEqual([dayIds[2], dayIds[0], dayIds[1]]);
    expect(readTrip(doc).days.map((d) => d.date)).toEqual(["2026-11-27", "2026-11-28", "2026-11-29"]);

    // Escape closes it, focus back on ⋯.
    fireEvent.keyDown(within(rail()).getByRole("group", { name: "Day 1 options" }), { key: "Escape" });
    expect(within(rail()).queryByRole("group", { name: /options$/ })).toBeNull();
    await frame();
    expect(document.activeElement).toBe(menu(1));

    // One Ctrl+Z step per move.
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(readTrip(doc).days.map((d) => d.id)).toEqual([dayIds[0], dayIds[2], dayIds[1]]);
  });

  it("Rename sets the day's title (Enter), Escape leaves it", async () => {
    const { doc, dayIds } = newTrip({ days: 2 });
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(openMenu(2)).getByRole("button", { name: "Rename" }));
    const input = within(rail()).getByRole("textbox", { name: "Title for Day 2" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.maxLength).toBe(40);
    fireEvent.change(input, { target: { value: "  Karaköy & Galata " } });
    fireEvent.submit(input.closest("form")!);
    expect(readTrip(doc).days[1].title).toBe("Karaköy & Galata");
    expect(railDays()[1].textContent).toBe("Day 2 · Sat 28Karaköy & Galata");
    await frame();
    expect(document.activeElement).toBe(menu(2));

    fireEvent.click(within(openMenu(2)).getByRole("button", { name: "Rename" }));
    const again = within(rail()).getByRole("textbox", { name: "Title for Day 2" }) as HTMLInputElement;
    expect(again.value).toBe("Karaköy & Galata");
    fireEvent.change(again, { target: { value: "Something else" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(readTrip(doc).days[1].title).toBe("Karaköy & Galata");
    expect(dayIds).toHaveLength(2);
  });

  it("Delete day sends its places to Ideas in one step; the toast's Undo (focused) brings it all back, keeping a friend's edit", async () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[1], time: "10:00" }, "u1");
    addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[1] }, "u1");
    setDay(doc, dayIds[1], { title: "Karaköy" }, "u1");
    at(`?view=day&day=${dayIds[1]}`);
    renderIntl(<TripScreen tripId="t1" />);

    fireEvent.click(within(openMenu(2)).getByRole("button", { name: "Delete day" }));
    let trip = readTrip(doc);
    expect(trip.days.map((d) => d.id)).toEqual([dayIds[0], dayIds[2]]);
    expect(trip.ideas.map((p) => p.name)).toEqual(["Galata Tower", "Karaköy Lokantası"]);
    expect(railLabels()).toEqual(["Day 1 · Fri 27", "Day 2 · Sat 28"]);
    expect(toastText()).toBe("Day 2 deleted. Its 2 stops are in Ideas.");
    const undo = screen.getByRole("button", { name: "Undo deleting Day 2" });
    expect(document.activeElement).toBe(undo);

    // Meanwhile a friend renames one of the moved places.
    remoteEdit("u2", (d, as) => updatePlace(d, tower, { name: "Galata Kulesi" }, as));
    fireEvent.click(undo);
    trip = readTrip(doc);
    expect(trip.days.map((d) => d.id)).toEqual(dayIds);
    expect(trip.days[1].title).toBe("Karaköy");
    expect(trip.days[1].places.map((p) => `${p.name}:${p.time}`)).toEqual(["Galata Kulesi:10:00", "Karaköy Lokantası:null"]);
    expect(trip.ideas).toEqual([]);
    // Shown again, and focused on the rail.
    expect(names(day(2))).toEqual(["Galata Kulesi", "Karaköy Lokantası"]);
    await frame();
    expect(document.activeElement).toBe(railDays()[1]);
  });

  it("the toast's Undo puts a moved day back", () => {
    const { dayIds } = newTrip({ days: 3 });
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(openMenu(3)).getByRole("button", { name: "Move up" }));
    expect(readTrip(fake.doc).days.map((d) => d.id)).toEqual([dayIds[0], dayIds[2], dayIds[1]]);
    expect(toastText()).toBe("Day 3 is now Day 2, Sat, Nov 28");
    fireEvent.click(screen.getByRole("button", { name: "Undo moving Day 3" }));
    expect(readTrip(fake.doc).days.map((d) => d.id)).toEqual(dayIds);
  });

  it("the move's toast Undo works when pressed with the ⋯ menu still open (closing the menu writes nothing)", () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    renderIntl(<TripScreen tripId="t1" />);
    const group = openMenu(2);
    fireEvent.click(within(group).getByRole("button", { name: "Move up" }));
    expect(readTrip(doc).days.map((d) => d.id)).toEqual([dayIds[1], dayIds[0], dayIds[2]]);
    expect(within(rail()).getByRole("group", { name: "Day 1 options" })).toBeTruthy();
    // A mouse press on the toast's Undo: pointerdown (outside the menu, which closes it), then click.
    const undo = screen.getByRole("button", { name: "Undo moving Day 2" });
    fireEvent.pointerDown(undo);
    fireEvent.mouseDown(undo);
    fireEvent.click(undo);
    expect(readTrip(doc).days.map((d) => d.id)).toEqual(dayIds);
    expect(within(rail()).queryByRole("group", { name: /options$/ })).toBeNull();
  });

  it("the move's toast Undo still works after Rename was opened and left unchanged (leaving it writes nothing)", () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(openMenu(2)).getByRole("button", { name: "Move up" }));
    fireEvent.click(within(within(rail()).getByRole("group", { name: "Day 1 options" })).getByRole("button", { name: "Rename" }));
    const input = within(rail()).getByRole("textbox", { name: "Title for Day 1" });
    input.focus();
    let writes = 0;
    const count = (tr: { origin: unknown }) => void (tr.origin === "u1" && writes++);
    doc.on("afterTransaction", count);
    // The press on Undo: pointerdown (closes the menu), focus moves to Undo (the title field blurs), click.
    const undo = screen.getByRole("button", { name: "Undo moving Day 2" });
    fireEvent.pointerDown(undo);
    fireEvent.mouseDown(undo);
    fireEvent.blur(input, { relatedTarget: undo });
    expect(writes).toBe(0);
    fireEvent.click(undo);
    doc.off("afterTransaction", count);
    expect(readTrip(doc).days.map((d) => d.id)).toEqual(dayIds);
  });

  it("an own transaction that changes nothing (Rename left as it was, Enter) neither closes the toast nor costs its Undo", () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    setDay(doc, dayIds[1], { title: "Balat" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(openMenu(2)).getByRole("button", { name: "Move up" }));
    fireEvent.click(within(within(rail()).getByRole("group", { name: "Day 1 options" })).getByRole("button", { name: "Rename" }));
    const input = within(rail()).getByRole("textbox", { name: "Title for Day 1" });
    fireEvent.change(input, { target: { value: " Balat " } });
    fireEvent.submit(input.closest("form")!);
    // Any other empty write of this person's, too.
    act(() => doc.transact(() => undefined, "u1"));
    fireEvent.click(screen.getByRole("button", { name: "Undo moving Balat" }));
    expect(readTrip(doc).days.map((d) => d.id)).toEqual(dayIds);
  });

  it("after Move up the menu follows its button and the moved day is scrolled into view", () => {
    newTrip({ days: 3 });
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    renderIntl(<TripScreen tripId="t1" />);
    const rect = (bottom: number) => () => ({ top: bottom - 32, bottom, left: 150, right: 182, width: 32, height: 32, x: 150, y: bottom - 32, toJSON: () => ({}) }) as DOMRect;
    menu(3).getBoundingClientRect = rect(200);
    const group = openMenu(3);
    expect(group.style.top).toBe("204px");
    menu(3).getBoundingClientRect = rect(140);
    fireEvent.click(within(group).getByRole("button", { name: "Move up" }));
    expect(within(rail()).getByRole("group", { name: "Day 2 options" }).style.top).toBe("144px");
    expect(scrolled).toContain(railDays()[1]);
  });

  it("Escape on ⋯ with its menu open closes it", () => {
    newTrip({ days: 2 });
    renderIntl(<TripScreen tripId="t1" />);
    openMenu(2);
    fireEvent.keyDown(menu(2), { key: "Escape" });
    expect(within(rail()).queryByRole("group", { name: "Day 2 options" })).toBeNull();
    expect(menu(2).getAttribute("aria-expanded")).toBe("false");
  });

  it("Rename saves when the menu closes by a press elsewhere, a scroll or a resize; only Escape drops it", () => {
    const { doc } = newTrip({ days: 2 });
    renderIntl(<TripScreen tripId="t1" />);
    const rename = (value: string) => {
      fireEvent.click(within(openMenu(2)).getByRole("button", { name: "Rename" }));
      fireEvent.change(within(rail()).getByRole("textbox", { name: "Title for Day 2" }), { target: { value } });
    };
    rename("Balat");
    fireEvent.pointerDown(document.body);
    expect(readTrip(doc).days[1].title).toBe("Balat");
    expect(within(rail()).queryByRole("group", { name: "Day 2 options" })).toBeNull();
    rename("Fener");
    fireEvent.scroll(rail());
    expect(readTrip(doc).days[1].title).toBe("Fener");
    rename("Kadıköy");
    fireEvent(window, new Event("resize"));
    expect(readTrip(doc).days[1].title).toBe("Kadıköy");
    rename("nope");
    fireEvent.keyDown(within(rail()).getByRole("textbox", { name: "Title for Day 2" }), { key: "Escape" });
    expect(readTrip(doc).days[1].title).toBe("Kadıköy");
  });

  it("delete a day, then rename another: the delete's Undo never reverts the rename", () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(openMenu(2)).getByRole("button", { name: "Delete day" }));
    const undo = screen.getByRole("button", { name: "Undo deleting Day 2" });
    fireEvent.click(within(openMenu(1)).getByRole("button", { name: "Rename" }));
    const input = within(rail()).getByRole("textbox", { name: "Title for Day 1" });
    fireEvent.change(input, { target: { value: "Karaköy" } });
    fireEvent.submit(input.closest("form")!);
    expect(readTrip(doc).days[0].title).toBe("Karaköy");
    // The toast went the moment this person did something else; even a stale press of its Undo does nothing.
    expect(screen.queryByRole("button", { name: "Undo deleting Day 2" })).toBeNull();
    fireEvent.click(undo);
    expect(readTrip(doc).days.map((d) => d.id)).toEqual([dayIds[0], dayIds[2]]);
    expect(readTrip(doc).days[0].title).toBe("Karaköy");
  });

  it("the only day cannot be deleted, and says why", () => {
    const { doc } = newTrip({ days: 1 });
    renderIntl(<TripScreen tripId="t1" />);
    const del = within(openMenu(1)).getByRole("button", { name: "Delete day" });
    expect(del.getAttribute("aria-disabled")).toBe("true");
    expect(del.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(del.getAttribute("aria-describedby")!)!.textContent).toBe("A trip needs at least one day.");
    fireEvent.click(del);
    expect(readTrip(doc).days).toHaveLength(1);
  });

  it("days are dragged onto each other (pointer only), and stops still drop on rail days", () => {
    const { doc, dayIds } = newTrip({ days: 3 });
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const view = readTrip(doc);
    // A day dropped on another takes its position; anywhere else, nowhere.
    expect(dayDropTarget(view, railDayDragId(dayIds[0]), `rail:day:${dayIds[2]}`)).toEqual({ dayId: dayIds[0], toIndex: 2 });
    expect(dayDropTarget(view, railDayDragId(dayIds[2]), `rail:day:${dayIds[0]}`)).toEqual({ dayId: dayIds[2], toIndex: 0 });
    expect(dayDropTarget(view, railDayDragId(dayIds[0]), `rail:day:${dayIds[0]}`)).toBeNull();
    expect(dayDropTarget(view, railDayDragId(dayIds[0]), "rail:ideas")).toBeNull();
    expect(dayDropTarget(view, railDayDragId(dayIds[0]), `place:${tower}`)).toBeNull();
    expect(dayDropTarget(view, tower, `rail:day:${dayIds[1]}`)).toBeNull();
    // A stop dragged onto a rail day still moves there.
    expect(dropTarget(view, tower, `rail:day:${dayIds[1]}`)).toEqual({ dayId: dayIds[1] });
    // The day button is both the drop target for stops and the drag handle; no keyboard drag is offered
    // (the ⋯ menu is the keyboard way), so no "draggable" role description.
    const first = railDays()[0];
    expect(first.getAttribute("data-drop")).toBe(`rail:day:${dayIds[0]}`);
    expect(first.getAttribute("aria-roledescription")).toBeNull();
    expect(first.getAttribute("aria-describedby")).toBeNull();
  });

  it("read-only: no ⋯ menus", () => {
    newTrip({ days: 2 });
    fake.closed = null;
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(rail()).queryByRole("button", { name: /options$/ })).toBeNull();
  });
});

describe("people in the header", () => {
  const members = [
    { id: "u1", name: "Ann", colour: "#2563eb", role: "owner" },
    { id: "u2", name: "Deniz", colour: "#ea580c", role: "member" },
  ];
  const serve = (list: typeof members) => {
    const { fn } = stubFetch({
      "GET /api/trips/t1": () => ({ body: { id: "t1", name: "Istanbul long weekend", startDate: "2026-11-27", days: 2, role: "owner", members: list } }),
      "GET /api/trips/t1/invites": () => ({ body: [] }),
    });
    vi.stubGlobal("fetch", fn);
  };

  it("the avatars open the people sheet: who is on the trip, their roles, invites; focus comes back", async () => {
    newTrip();
    serve(members);
    renderIntl(<TripScreen tripId="t1" />);
    const header = screen.getByRole("banner");
    // Named for the trip's members, then who is here now: the avatars it shows are named by their content (label in name, WCAG 2.5.3).
    const avatars = within(header).getByRole("button", { name: "People: Ann, Deniz. In this trip now: Ann (you)" });
    expect(avatars.hasAttribute("aria-label")).toBe(false);
    expect(avatars.getAttribute("aria-haspopup")).toBe("dialog");
    // Two members: the button says Share.
    expect(within(header).getByRole("button", { name: "Share" })).toBeTruthy();
    expect(within(header).queryByRole("button", { name: "Invite friends" })).toBeNull();

    avatars.focus();
    fireEvent.click(avatars);
    const dialog = await screen.findByRole("dialog", { name: "People" });
    const list = await within(dialog).findByRole("list", { name: "People on this trip" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["AAnn (you)Owner", "DDenizMemberMake ownerRemove"]);
    expect(await within(dialog).findByRole("heading", { name: "Invite people" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(avatars);
  });

  it("a trip with only its owner shows Invite friends, which opens the same sheet", async () => {
    const { doc } = newTrip();
    doc.getMap("members").delete("u2");
    serve(members.slice(0, 1));
    renderIntl(<TripScreen tripId="t1" />);
    const header = screen.getByRole("banner");
    const invite = within(header).getByRole("button", { name: "Invite friends" });
    expect(within(header).queryByRole("button", { name: "Share" })).toBeNull();
    fireEvent.click(invite);
    const dialog = await screen.findByRole("dialog", { name: "People" });
    expect(await within(dialog).findByRole("heading", { name: "Invite people" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(invite);
  });

  it("Undo and Redo show their names from 1280 px, and their shortcuts as tooltips", () => {
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo.title).toBe("Undo (Ctrl+Z or ⌘Z)");
    expect(redo.title).toBe("Redo (Ctrl+Shift+Z or ⌘⇧Z)");
    for (const [button, text] of [
      [undo, "Undo"],
      [redo, "Redo"],
    ] as const) {
      const label = button.querySelector("span")!;
      expect(label.textContent).toBe(text);
      expect(label.className).toMatch(/(^| )hidden( |$)/);
      expect(label.className).toMatch(/(^| )xl:inline( |$)/);
    }
  });

  it("the people sheet and Invite friends in Turkish", async () => {
    const { doc } = newTrip();
    doc.getMap("members").delete("u2");
    serve(members.slice(0, 1));
    renderIntl(<TripScreen tripId="t1" />, "tr");
    fireEvent.click(screen.getByRole("button", { name: "Arkadaşlarınızı davet edin" }));
    expect(await screen.findByRole("dialog", { name: "Kişiler" })).toBeTruthy();
  });
});

describe("undo toasts", () => {
  it("delete stop: Undo restores it, not a friend's edit made meanwhile", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    const pera = addPlace(doc, { name: "Pera", category: "museum", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    openDetails("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Delete Galata Tower" }));
    expect(toastText()).toBe("Galata Tower deleted.");
    remoteEdit("u2", (d, as) => updatePlace(d, pera, { name: "Pera Museum" }, as));
    fireEvent.click(screen.getByRole("button", { name: "Undo deleting Galata Tower" }));
    expect(readTrip(doc).days[0].places.map((p) => p.name)).toEqual(["Galata Tower", "Pera Museum"]);
  });

  it("delete stop is its own undo step: an edit right after it undoes on its own", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    const pera = addPlace(doc, { name: "Pera", category: "museum", dayId: dayIds[1] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    openDetails("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Delete Galata Tower" }));
    // Within 500 ms, another edit of this person's (not a toasted action).
    act(() => vote(doc, pera, "u1", 1));
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    const trip = readTrip(doc);
    expect(trip.days[1].places[0].votes).toEqual({});
    expect(trip.days[0].places).toEqual([]);
  });

  it("a friend changes the very field Undo restores: Undo reverts only this person's change (theirs stays)", () => {
    const { doc, dayIds } = newTrip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], time: "09:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Change the time for A, now 09:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time for A" }), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time for A" }), { key: "Enter" });
    // Deniz sets a time of their own after the clear; the clear's Undo does not overwrite it.
    remoteEdit("u2", (d, as) => setPlaceTime(d, a, "11:00", as));
    fireEvent.click(screen.getByRole("button", { name: "Undo clearing the time of A" }));
    expect(readTrip(doc).days[0].places[0].time).toBe("11:00");

    // Same for a move: Deniz moves the place on to Ideas; Undo of mine does not pull it back.
    let b = "";
    act(() => void (b = addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0] }, "u1")));
    openDetails("B");
    fireEvent.click(screen.getByRole("button", { name: "Move B to…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /^Day 2/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move" }));
    remoteEdit("u2", (d, as) => movePlace(d, b, { dayId: null }, as));
    fireEvent.click(screen.getByRole("button", { name: "Undo moving B" }));
    // B stays where Deniz put it, and the Undo did not go on to remove B (the add before the move).
    expect(readTrip(doc).ideas.map((p) => p.id)).toEqual([b]);
  });

  it("move to another day: Undo puts it back with its time, keeping a friend's rename", () => {
    const { doc, dayIds } = newTrip();
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], time: "15:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    openDetails("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Move Galata Tower to…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /^Day 2/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move" }));
    expect(toastText()).toBe("Galata Tower moved to Day 2 at 15:00, position 1 of 1");
    remoteEdit("u2", (d, as) => updatePlace(d, tower, { name: "Galata Kulesi" }, as));
    fireEvent.click(screen.getByRole("button", { name: "Undo moving Galata Tower" }));
    const trip = readTrip(doc);
    expect(trip.days[0].places.map((p) => `${p.name}:${p.time}`)).toEqual(["Galata Kulesi:15:00"]);
    expect(trip.days[1].places).toEqual([]);
  });

  it("move to Ideas: Undo puts it back in its day at its time, keeping a friend's edit", () => {
    const { doc, dayIds } = newTrip();
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], time: "15:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    openDetails("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Move Galata Tower to…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Ideas" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move" }));
    expect(toastText()).toBe("Galata Tower moved to Ideas, position 1 of 1");
    remoteEdit("u2", (d, as) => updatePlace(d, tower, { stayMinutes: 90 }, as));
    fireEvent.click(screen.getByRole("button", { name: "Undo moving Galata Tower" }));
    const trip = readTrip(doc);
    expect(trip.ideas).toEqual([]);
    expect(trip.days[0].places.map((p) => `${p.name}:${p.time}:${p.stayMinutes}`)).toEqual(["Galata Tower:15:00:90"]);
  });

  it("dismiss and accept a suggestion: each has an Undo that keeps a friend's vote", () => {
    const { doc, dayIds } = newTrip();
    const moda = addPlace(doc, { name: "Moda Sahil", category: "nature", dayId: null, status: "suggested" }, "u2");
    at("?view=ideas");
    renderIntl(<TripScreen tripId="t1" />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Moda Sahil" }));
    expect(readTrip(doc).dismissed.map((p) => p.id)).toEqual([moda]);
    expect(toastText()).toBe("Moda Sahil dismissed.");
    remoteEdit("u2", (d, as) => vote(d, moda, as, 1));
    fireEvent.click(screen.getByRole("button", { name: "Undo dismissing Moda Sahil" }));
    expect(readTrip(doc).suggestions.map((p) => [p.id, p.votes])).toEqual([[moda, { u2: 1 }]]);

    fireEvent.click(screen.getByRole("button", { name: "Accept Moda Sahil" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Day 2/ }));
    fireEvent.change(within(dialog).getByLabelText("Time"), { target: { value: "11:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    expect(readTrip(doc).days[1].places.map((p) => `${p.name}:${p.time}`)).toEqual(["Moda Sahil:11:00"]);
    expect(toastText()).toBe("Moda Sahil accepted into Day 2 at 11:00.");
    remoteEdit("u3", (d, as) => vote(d, moda, as, -1));
    fireEvent.click(screen.getByRole("button", { name: "Undo accepting Moda Sahil" }));
    const trip = readTrip(doc);
    expect(trip.days[1].places).toEqual([]);
    expect(trip.suggestions.map((p) => [p.id, p.votes])).toEqual([[moda, { u2: 1, u3: -1 }]]);
    expect(dayIds).toHaveLength(2);
  });

  it("shift day: Undo reverts the shift, not a friend's title", () => {
    const { doc, dayIds } = newTrip({ days: 1 });
    addPlace(doc, { name: "Breakfast", category: "food", dayId: dayIds[0], time: "09:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(day(1)).getByRole("button", { name: "Shift times" }));
    fireEvent.click(within(day(1)).getByRole("button", { name: "+30 min, later" }));
    expect(readTrip(doc).days[0].places[0].time).toBe("09:30");
    remoteEdit("u2", (d, as) => setDay(d, dayIds[0], { title: "Kadıköy" }, as));
    fireEvent.click(screen.getByRole("button", { name: "Undo shifting the times of Day 1" }));
    expect(readTrip(doc).days[0].places[0].time).toBe("09:00");
    expect(readTrip(doc).days[0].title).toBe("Kadıköy");
  });

  it("clear a time: Undo brings the time back, keeping a friend's rename; Ctrl+Z works too", () => {
    const { doc, dayIds } = newTrip();
    const a = addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], time: "09:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Change the time for A, now 09:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time for A" }), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time for A" }), { key: "Enter" });
    expect(readTrip(doc).days[0].places[0].time).toBeNull();
    expect(toastText()).toBe("A has no set time");
    remoteEdit("u2", (d, as) => updatePlace(d, a, { name: "Ayasofya" }, as));
    // The toast's Undo is a real, focusable button (keyboard: Tab to it, Enter).
    const undo = screen.getByRole("button", { name: "Undo clearing the time of A" });
    expect(undo.tagName).toBe("BUTTON");
    expect(undo.tabIndex).toBe(0);
    fireEvent.click(undo);
    expect(readTrip(doc).days[0].places.map((p) => `${p.name}:${p.time}`)).toEqual(["Ayasofya:09:00"]);

    // Ctrl+Z also undoes a cleared time.
    fireEvent.click(screen.getByRole("button", { name: "Change the time for Ayasofya, now 09:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time for Ayasofya" }), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time for Ayasofya" }), { key: "Enter" });
    expect(readTrip(doc).days[0].places[0].time).toBeNull();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(readTrip(doc).days[0].places[0].time).toBe("09:00");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as Y from "yjs";
import { addPlace, createUndo, dayUrls, setPlaceTime } from "@rota/trip";
import { MapLoaderContext } from "@/components/map/engine";
import { fakeMap } from "../map/fakeMap";
import { renderIntl, stubFetch } from "./helpers";
import { fake, newTrip, useFakeTrip } from "./tripHarness";

vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
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
import { dropPlace } from "@/components/trip/plan";

const at = (search: string) => window.history.replaceState(null, "", `/en/t/t1${search}`);
beforeEach(() => at(""));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  at("");
});

const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
const names = (region: HTMLElement) => within(region).queryAllByTestId("place-name").map((e) => e.textContent);
const day = (n: number) => screen.getByRole("region", { name: new RegExp(`^Day ${n}\\b`) });
const search = () => screen.getByRole("combobox", { name: /^Add a place to/ });
const offline = () => vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

const galata = { name: "Galata Kulesi", label: "Bereketzade, Beyoğlu, İstanbul, Türkiye", lat: 41.0256, lng: 28.9742, osmId: "w32514112", category: "sight" };
const pera = { name: "Pera Müzesi", label: "Meşrutiyet Caddesi 65, Beyoğlu, İstanbul, Türkiye", lat: 41.0317, lng: 28.9752, osmId: "n12", category: "museum" };

describe("day plan", () => {
  it("rows show number, icon, name, sub-line, arrival and stay only", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", tags: ["views", "sunset"], stayMinutes: 60, dayId: dayIds[0], time: "10:00" }, "u1");
    addPlace(doc, { name: "Pera Museum", category: "museum", stayMinutes: 75, dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Balat", category: "sight", dayId: dayIds[1] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    const tower = row("Galata Tower");
    expect(tower.textContent).toContain("1");
    expect(within(tower).getByRole("img", { name: "Sight" })).toBeTruthy();
    expect(within(tower).getByTestId("place-sub").textContent).toBe("Sight · views, sunset");
    expect(within(tower).getByText("10:00")).toBeTruthy();
    expect(within(tower).getByText("1 h")).toBeTruthy();
    // Nothing else on the row: the place itself (opens it) and its time.
    expect(within(tower).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Galata Tower",
      "Change the time for Galata Tower, now 10:00",
    ]);
    expect(within(tower).queryByRole("link")).toBeNull();
    expect(within(tower).queryByRole("textbox")).toBeNull();

    const museum = row("Pera Museum");
    expect(within(museum).getByText("2")).toBeTruthy();
    expect(within(museum).getByTestId("place-sub").textContent).toBe("Museum");
    // Estimated from the stop before: 10:00 + 60 min stay, no travel known.
    expect(within(museum).getByTestId("place-time").textContent).toBe("≈ estimated, 11:00");
    expect(within(museum).getByText("1 h 15 min")).toBeTruthy();
    // Only the selected day.
    expect(screen.queryByText("Balat")).toBeNull();
  });

  it("connector shows travel time or ≈ estimate", async () => {
    const { doc, dayIds } = newTrip({ days: 1 });
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0], lat: 41.0256, lng: 28.9742, time: "09:00" }, "u1");
    addPlace(doc, { name: "Pera Museum", category: "museum", dayId: dayIds[0], lat: 41.0317, lng: 28.9752 }, "u1");
    const { fn } = stubFetch({
      "GET /api/route?mode=walk&coords=28.9742,41.0256;28.9752,41.0317": () => ({ body: { legs: [{ seconds: 720, meters: 950 }], geometry: { type: "LineString", coordinates: [] } } }),
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);
    const leg = () => within(day(1)).getByTestId("travel-leg");
    // Until the route arrives: a straight-line estimate, marked.
    expect(leg().textContent).toMatch(/^≈/);
    await waitFor(() => expect(leg().textContent).toBe("12 min walk · 950 m"));
    expect(within(row("Pera Museum")).getByTestId("place-time").textContent).toBe("≈ estimated, 09:57");

    cleanup();
    const { doc: d2, dayIds: ids2 } = newTrip({ days: 1 });
    addPlace(d2, { name: "A", category: "sight", dayId: ids2[0], lat: 41.0256, lng: 28.9542 }, "u1");
    addPlace(d2, { name: "B", category: "sight", dayId: ids2[0], lat: 41.0317, lng: 28.9552 }, "u1");
    addPlace(d2, { name: "No pin", category: "other", dayId: ids2[0] }, "u1");
    offline();
    renderIntl(<TripScreen tripId="t1" />);
    const legs = within(day(1)).getAllByTestId("travel-leg");
    expect(legs[0].textContent).toMatch(/^≈ estimated, \d+ min walk · \d+ m$/);
    // No pin, no travel: just the line between the rows.
    expect(legs[1].textContent).toBe("");
    // The lines between rows are not list items: the list says "3 items" for 3 stops.
    expect(within(within(day(1)).getByRole("list")).getAllByRole("listitem")).toHaveLength(3);
    expect(legs.every((l) => l.getAttribute("role") === "none")).toBe(true);
  });

  it("search result actions add to the day, to Ideas, or as a suggestion", async () => {
    const { dayIds } = newTrip();
    // Results for the query, whatever the area they are biased to.
    const fn = vi.fn(async (url: string) => {
      const q = new URL(String(url), "http://x").searchParams.get("q");
      if (!String(url).startsWith("/api/geocode")) return new Response(null, { status: 503 });
      return new Response(JSON.stringify({ results: q === "Galata" ? [galata, pera] : q === "Pera" ? [pera] : [] }));
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);
    expect(search().getAttribute("placeholder")).toBe("Add a place to Day 1…");

    fireEvent.change(search(), { target: { value: "Galata" } });
    fireEvent.click(await screen.findByRole("option", { name: /Galata Kulesi/ }));
    const step = screen.getByRole("form", { name: "Add Galata Kulesi" });
    expect(within(step).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Add to Day 1",
      "Add to Ideas",
      "Suggest",
      "Cancel",
    ]);
    fireEvent.click(within(step).getByRole("button", { name: "Add to Day 1" }));
    expect(fake.view.days[0].places[0]).toMatchObject({ name: "Galata Kulesi", lat: galata.lat, osmId: galata.osmId, address: galata.label, category: "sight", dayId: dayIds[0] });
    expect(screen.queryByRole("form", { name: /^Add / })).toBeNull();
    expect((search() as HTMLInputElement).value).toBe("");

    fireEvent.change(search(), { target: { value: "Pera" } });
    fireEvent.click(await screen.findByRole("option", { name: /Pera Müzesi/ }));
    fireEvent.click(within(screen.getByRole("form", { name: "Add Pera Müzesi" })).getByRole("button", { name: "Add to Ideas" }));
    expect(fake.view.ideas.map((p) => p.name)).toEqual(["Pera Müzesi"]);
    expect(fake.view.ideas[0].time).toBeNull();

    // Typed, not picked: added by name.
    offline();
    fireEvent.change(search(), { target: { value: "Pierre Loti Hill" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    fireEvent.click(within(screen.getByRole("form", { name: "Add Pierre Loti Hill" })).getByRole("button", { name: "Suggest" }));
    expect(fake.view.suggestions.map((p) => p.name)).toEqual(["Pierre Loti Hill"]);
    expect(fake.view.days[0].places.map((p) => p.name)).toEqual(["Galata Kulesi"]);
  });

  it("Enter in the search adds to the selected day", () => {
    const { dayIds } = newTrip();
    at(`?view=day&day=${dayIds[1]}`);
    offline();
    renderIntl(<TripScreen tripId="t1" />);
    expect(search().getAttribute("placeholder")).toBe("Add a place to Day 2…");
    fireEvent.change(search(), { target: { value: "  Galata Tower " } });
    fireEvent.keyDown(search(), { key: "Enter" });
    const time = screen.getByLabelText("Time");
    expect(document.activeElement).toBe(time);
    fireEvent.keyDown(time, { key: "Enter" });
    expect(fake.view.days[1].places.map((p) => p.name)).toEqual(["Galata Tower"]);
    expect(fake.view.days[0].places).toEqual([]);
    expect(document.activeElement).toBe(search());

    // Escape leaves the step without adding.
    fireEvent.change(search(), { target: { value: "Pera" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("Time"), { key: "Escape" });
    expect(screen.queryByRole("form", { name: /^Add / })).toBeNull();
    expect(fake.view.days[1].places).toHaveLength(1);
  });

  it("filter popover dims/hides like before and reports hidden count", async () => {
    at("?view=all");
    const { doc, dayIds } = newTrip();
    const lokanta = addPlace(doc, { name: "Karaköy Lokantası", category: "food", tags: ["lunch"], dayId: dayIds[0], lat: 41.0228, lng: 28.9779 }, "u1");
    addPlace(doc, { name: "Pera Museum", category: "museum", tags: ["Views"], dayId: dayIds[0], lat: 41.0317, lng: 28.9752 }, "u1");
    addPlace(doc, { name: "Istanbul Modern", category: "museum", tags: ["views"], dayId: null, lat: 41.0267, lng: 28.9836 }, "u1");
    const map = fakeMap();
    renderIntl(
      <MapLoaderContext.Provider value={map.load}>
        <TripScreen tripId="t1" />
      </MapLoaderContext.Provider>,
    );
    const pinned = () => [...document.querySelectorAll<HTMLElement>("[data-pin]")].map((p) => p.dataset.pin);
    await waitFor(() => expect(pinned()).toHaveLength(3));
    const hidden = (name: string) => row(name).dataset.dimmed === "true";

    const button = screen.getByRole("button", { name: "Filter" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Category" })).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const filters = screen.getByRole("group", { name: "Category" });
    const food = within(filters).getByRole("button", { name: "Food" });
    fireEvent.click(food);
    expect(food.getAttribute("aria-pressed")).toBe("true");
    expect(hidden("Karaköy Lokantası")).toBe(false);
    expect(hidden("Pera Museum")).toBe(true);
    expect(hidden("Istanbul Modern")).toBe(true);
    expect(within(row("Pera Museum")).getByText("Hidden by filters")).toBeTruthy();
    expect(screen.getAllByText("2 places hidden by filters").length).toBeGreaterThan(0);
    expect(pinned()).toEqual([lokanta]);

    // Escape closes the popover, focus back on its button; the count stays in sight.
    fireEvent.keyDown(filters, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Category" })).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(screen.getByText("2 places hidden by filters")).toBeTruthy();

    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole("group", { name: "Category" })).getByRole("button", { name: "Food" }));
    const tag = screen.getByLabelText("Tag");
    expect(within(tag).getAllByRole("option").map((o) => o.textContent)).toEqual(["All tags", "lunch", "Views"]);
    fireEvent.change(tag, { target: { value: "views" } });
    expect(hidden("Pera Museum")).toBe(false);
    expect(hidden("Karaköy Lokantası")).toBe(true);
    expect(screen.getAllByText("1 place hidden by filters").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByText(/hidden by filters/)).toBeNull();
  });

  it("dropping on a rail day moves the place", () => {
    const { doc, dayIds } = newTrip();
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", stayMinutes: 60, dayId: dayIds[0], time: "10:00" }, "u1");
    addPlace(doc, { name: "Balat", category: "sight", stayMinutes: 60, dayId: dayIds[1], time: "08:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const undo = createUndo(doc, "u1");
    // The drop the trip screen makes when a row lands on the rail's Day 2: its time kept, placed by it (ruling F1).
    expect(dropPlace(doc, fake.view, tower, `rail:day:${dayIds[1]}`, "u1")).toBe(true);
    expect(fake.view.days[1].places.map((p) => [p.name, p.time])).toEqual([
      ["Balat", "08:00"],
      ["Galata Tower", "10:00"],
    ]);
    // One step to undo.
    undo.undo();
    expect(fake.view.days[0].places.map((p) => [p.name, p.time])).toEqual([["Galata Tower", "10:00"]]);
    // Onto Ideas: unscheduled; onto a day that is gone: nothing.
    expect(dropPlace(doc, fake.view, tower, "rail:ideas", "u1")).toBe(true);
    expect(fake.view.ideas.map((p) => p.name)).toEqual(["Galata Tower"]);
    expect(dropPlace(doc, fake.view, tower, "rail:day:gone", "u1")).toBe(false);
    undo.destroy();

    // The rail's days are drop targets.
    expect(document.querySelector(`[data-drop="rail:day:${dayIds[1]}"]`)).toBeTruthy();
    expect(document.querySelector('[data-drop="rail:ideas"]')).toBeTruthy();
  });

  it("Alt+ArrowDown reorders and announces", async () => {
    const { doc, dayIds } = newTrip();
    for (const name of ["A", "B", "C"]) addPlace(doc, { name, category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const a = within(row("A")).getByRole("button", { name: "A" });
    expect(a.getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowUp Alt+ArrowDown");
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowDown", altKey: true });
    expect(names(day(1))).toEqual(["B", "A", "C"]);
    expect(screen.getByTestId("plan-status").textContent).toBe("A moved to position 2 of 3");
    expect(screen.getByTestId("plan-status").getAttribute("aria-live")).toBe("polite");
    await waitFor(() => expect(document.activeElement).toBe(within(row("A")).getByRole("button", { name: "A" })));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(within(row("A")).getByRole("button", { name: "A" }), { key: "ArrowUp", altKey: true });
    expect(names(day(1))).toEqual(["A", "B", "C"]);
    expect(screen.getByTestId("plan-status").textContent).toBe("A moved to position 1 of 3");
    // Plain arrows do nothing.
    fireEvent.keyDown(within(row("A")).getByRole("button", { name: "A" }), { key: "ArrowDown" });
    expect(names(day(1))).toEqual(["A", "B", "C"]);
  });

  it("a 120-character Turkish name truncates with full name available", () => {
    const { doc, dayIds } = newTrip();
    const long = "Şişli'deki ığdır usulü çağ kebabı yapan küçük dükkânın üst katındaki gün batımı terası ".repeat(3).slice(0, 120);
    expect(long).toHaveLength(120);
    addPlace(doc, { name: long, category: "food", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />, "tr");
    const name = screen.getByTestId("place-name");
    expect(name.textContent).toBe(long.trim());
    expect(name.className).toContain("truncate");
    expect(name.getAttribute("title")).toBe(long.trim());
    // Every box between the name and the row may shrink below its content's width.
    for (let el = name.parentElement; el && el.tagName !== "LI"; el = el.parentElement) expect(el.className).toContain("min-w-0");
    expect(name.closest("li")!.className).toContain("min-w-0");
  });

  it("30 stops scroll without horizontal overflow", () => {
    const { doc, dayIds } = newTrip();
    for (let i = 0; i < 30; i++) addPlace(doc, { name: `Stop ${i + 1}`, category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    expect(names(day(1))).toHaveLength(30);
    const main = screen.getByRole("main");
    expect(main.className).toContain("overflow-y-auto");
    expect(main.className).toContain("overflow-x-hidden");
    const list = row("Stop 30").parentElement!;
    expect(list.className).toContain("min-w-0");
    for (const li of within(list).getAllByRole("listitem")) expect(li.className).toContain("min-w-0");
  });

  it("day header edits travel mode and shows end time and Google Maps parts (no start-time control)", () => {
    at("?view=all");
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Breakfast", category: "food", stayMinutes: 60, dayId: dayIds[0], time: "09:00" }, "u1");
    addPlace(doc, { name: "Museum", category: "museum", stayMinutes: 45, dayId: dayIds[0] }, "u1");
    for (let i = 0; i < 12; i++) addPlace(doc, { name: `Stop ${i + 1}`, category: "sight", lat: 41 + i / 100, lng: 29, dayId: dayIds[1] }, "u1");
    offline();
    renderIntl(<TripScreen tripId="t1" />);

    expect(screen.queryByLabelText(/start time/i)).toBeNull();
    expect(within(day(1)).getByRole("heading", { level: 2 }).textContent).toMatch(/^Day 1 · Friday/);
    expect(within(day(1)).getByText("Ends around 10:45")).toBeTruthy();
    // Nothing timed on Day 2, so no end time.
    expect(within(day(2)).queryByText(/^Ends around/)).toBeNull();

    const modes = within(day(1)).getByRole("group", { name: "Getting around, Day 1" });
    expect(within(modes).getByRole("button", { name: "Walk" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(modes).getByRole("button", { name: "Drive" }));
    expect(fake.view.days[0].travelMode).toBe("drive");

    const links = within(day(2)).getAllByRole("link", { name: /Open day in Google Maps/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(dayUrls(fake.view.days[1], "walk"));
    expect(links.map((l) => l.textContent)).toEqual([expect.stringContaining("part 1 of 2"), expect.stringContaining("part 2 of 2")]);
    for (const l of links) expect(l.getAttribute("target")).toBe("_blank");
    expect(within(day(2)).getByTestId("travel-total").textContent).toMatch(/^≈ estimated, .* travel$/);
    expect(within(day(1)).queryByRole("link", { name: /Open day in Google Maps/ })).toBeNull();
  });

  it("adding asks for a time prefilled with the suggestion and adds at the chosen time", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Breakfast", category: "food", stayMinutes: 60, dayId: dayIds[0], time: "09:00", lat: 41.0256, lng: 28.9742 }, "u1");
    offline();
    renderIntl(<TripScreen tripId="t1" />);

    fireEvent.change(search(), { target: { value: "Galata Tower" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    const step = screen.getByRole("form", { name: "Add Galata Tower" });
    const time = within(step).getByLabelText("Time") as HTMLInputElement;
    // Breakfast ends at 10:00; no pin for the new place, so no travel to add.
    expect(time.value).toBe("10:00");
    expect((within(step).getByLabelText("Stay (minutes)") as HTMLInputElement).value).toBe("60");
    fireEvent.change(time, { target: { value: "8:15" } });
    fireEvent.change(within(step).getByLabelText("Stay (minutes)"), { target: { value: "30" } });
    fireEvent.click(within(step).getByRole("button", { name: "Add to Day 1" }));
    expect(fake.view.days[0].places.map((p) => [p.name, p.time, p.stayMinutes])).toEqual([
      ["Galata Tower", "08:15", 30],
      ["Breakfast", "09:00", 60],
    ]);

    // Left empty: added untimed, at the end.
    fireEvent.change(search(), { target: { value: "Pera" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Day 1" }));
    expect(fake.view.days[0].places.map((p) => [p.name, p.time])).toEqual([
      ["Galata Tower", "08:15"],
      ["Breakfast", "09:00"],
      ["Pera", null],
    ]);

    // Garbage is refused, not added.
    fireEvent.change(search(), { target: { value: "Balat" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "25:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Day 1" }));
    expect(screen.getByLabelText("Time").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a time like 09:30, or leave it empty.")).toBeTruthy();
    expect(fake.view.days[0].places).toHaveLength(3);

    // An empty day: nothing to suggest.
    cleanup();
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.change(search(), { target: { value: "Galata" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("");
  });

  it("clicking a row's time edits it and the stop moves into time order", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "A", category: "sight", stayMinutes: 30, dayId: dayIds[0], time: "09:00" }, "u1");
    addPlace(doc, { name: "B", category: "sight", stayMinutes: 30, dayId: dayIds[0], time: "10:00" }, "u1");
    addPlace(doc, { name: "C", category: "sight", stayMinutes: 30, dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    fireEvent.click(screen.getByRole("button", { name: "Change the time for B, now 10:00" }));
    const input = screen.getByRole("textbox", { name: "Time for B" }) as HTMLInputElement;
    expect(input.value).toBe("10:00");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "08:30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(names(day(1))).toEqual(["B", "A", "C"]);
    expect(fake.view.days[0].places[0].time).toBe("08:30");
    expect(screen.queryByRole("textbox", { name: "Time for B" })).toBeNull();

    // C has an estimate; it can be given a time of its own (committed on leaving the field).
    fireEvent.click(screen.getByRole("button", { name: /^Set a time for C/ }));
    const c = screen.getByRole("textbox", { name: "Time for C" });
    fireEvent.change(c, { target: { value: "7:05" } });
    fireEvent.blur(c);
    expect(names(day(1))).toEqual(["C", "B", "A"]);
    expect(fake.view.days[0].places[0].time).toBe("07:05");

    // Escape cancels.
    fireEvent.click(screen.getByRole("button", { name: "Change the time for A, now 09:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time for A" }), { target: { value: "11:00" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time for A" }), { key: "Escape" });
    expect(fake.view.days[0].places[2].time).toBe("09:00");

    // Empty clears it.
    fireEvent.click(screen.getByRole("button", { name: "Change the time for A, now 09:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time for A" }), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time for A" }), { key: "Enter" });
    expect(fake.view.days[0].places.find((p) => p.name === "A")!.time).toBeNull();
  });

  it("late warning shows on a row whose set time is unreachable", async () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Topkapı Palace", category: "museum", stayMinutes: 120, dayId: dayIds[0], time: "09:00" }, "u1");
    const lunch = addPlace(doc, { name: "Lunch", category: "food", stayMinutes: 60, dayId: dayIds[0], time: "10:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(row("Lunch")).getByText("You'd arrive ≈ 60 min late (from Topkapı Palace)")).toBeTruthy();
    expect(within(row("Topkapı Palace")).queryByText(/late/)).toBeNull();
    act(() => void setPlaceTime(doc, lunch, "11:00", "u1"));
    expect(within(row("Lunch")).queryByText(/late/)).toBeNull();

    // While the route is still being asked for, no warning from a guess; once it is known, it shows.
    cleanup();
    const { doc: d2, dayIds: ids2 } = newTrip();
    addPlace(d2, { name: "Galata Tower", category: "sight", stayMinutes: 60, dayId: ids2[0], time: "09:00", lat: 41.0256, lng: 28.9342 }, "u1");
    addPlace(d2, { name: "Pera Museum", category: "museum", dayId: ids2[0], time: "10:05", lat: 41.0317, lng: 28.9352 }, "u1");
    let answer!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => (String(url).startsWith("/api/route") ? new Promise<Response>((resolve) => (answer = resolve)) : Promise.resolve(new Response(null, { status: 503 })))),
    );
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(row("Pera Museum")).queryByText(/late/)).toBeNull();
    await waitFor(() => expect(answer).toBeTypeOf("function"));
    await act(async () => answer(new Response(JSON.stringify({ legs: [{ seconds: 900, meters: 1200 }], geometry: { type: "LineString", coordinates: [] } }))));
    expect(await within(row("Pera Museum")).findByText("You'd arrive ≈ 10 min late (from Galata Tower)")).toBeTruthy();
  });

  it("all view lists every day", () => {
    at("?view=all");
    const { doc, dayIds } = newTrip({ days: 3 });
    dayIds.forEach((dayId, i) => addPlace(doc, { name: `Stop on day ${i + 1}`, category: "sight", dayId }, "u1"));
    addPlace(doc, { name: "Maybe", category: "sight", dayId: null }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    for (const n of [1, 2, 3]) {
      expect(within(day(n)).getByRole("heading", { level: 2 }).textContent).toMatch(new RegExp(`^Day ${n} · `));
      expect(names(day(n))).toEqual([`Stop on day ${n}`]);
    }
    expect(names(screen.getByRole("region", { name: "Ideas" }))).toEqual(["Maybe"]);
  });
  it("the map's add-here hint is visible under the search", () => {
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);
    const hint = screen.getByText("Right-click or long-press the map to add a place there.");
    expect(hint.className).not.toContain("sr-only");
    expect(search().getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("an open stop's Move up/down buttons reorder, re-time and announce", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "A", category: "sight", stayMinutes: 60, dayId: dayIds[0], time: "09:00" }, "u1");
    addPlace(doc, { name: "B", category: "sight", stayMinutes: 30, dayId: dayIds[0], time: "10:00" }, "u1");
    addPlace(doc, { name: "C", category: "sight", stayMinutes: 30, dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByText(/Alt\+↑\/↓/)).toBeTruthy();
    const status = screen.getByTestId("plan-status");

    fireEvent.click(within(row("C")).getByRole("button", { name: "C" }));
    expect(screen.getByRole("button", { name: "Move C down" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Move C up" }));
    expect(names(day(1))).toEqual(["A", "C", "B"]);
    expect(status.textContent).toBe("C moved to position 2 of 3");

    fireEvent.click(within(row("B")).getByRole("button", { name: "B" }));
    fireEvent.click(screen.getByRole("button", { name: "Move B up" }));
    fireEvent.click(screen.getByRole("button", { name: "Move B up" }));
    expect(names(day(1))).toEqual(["B", "A", "C"]);
    // Re-timed for its new slot (never before the timed stop now after it).
    expect(fake.view.days[0].places[0].time).toBe("09:00");
    expect(status.textContent).toBe("B now at 09:00, position 1 of 3");
    expect(screen.getByRole("button", { name: "Move B up" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("changing a time says where the stop went and when", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], time: "09:00" }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0], time: "10:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Change the time for B, now 10:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time for B" }), { target: { value: "08:30" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time for B" }), { key: "Enter" });
    expect(screen.getByTestId("plan-status").textContent).toBe("B now at 08:30, position 1 of 2");
  });

  it("an invalid inline time says why (an alert) and stays open, without telling others it is edited once left", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], time: "09:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Change the time for A, now 09:00" }));
    const input = screen.getByRole("textbox", { name: "Time for A" });
    expect(fake.awareness.getLocalState()?.editing).toBe(id);
    fireEvent.change(input, { target: { value: "25:00" } });
    fireEvent.blur(input);
    expect(screen.getByRole("textbox", { name: "Time for A" })).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const message = screen.getByRole("alert");
    expect(message.textContent).toBe("Enter a time like 09:30, or leave it empty.");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    // Focus left the field: no lasting "editing" outline for others; back in it, it says so again.
    expect(fake.awareness.getLocalState()?.editing).toBeNull();
    fireEvent.focus(input);
    expect(fake.awareness.getLocalState()?.editing).toBe(id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Time for A" })).toBeTruthy();
    expect(fake.view.days[0].places[0].time).toBe("09:00");
  });

  it("setting the time of an estimated stop starts from the estimate", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "A", category: "sight", stayMinutes: 60, dayId: dayIds[0], time: "09:00" }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Set a time for B, estimated 10:00" }));
    const input = screen.getByRole("textbox", { name: "Time for B" }) as HTMLInputElement;
    expect(input.value).toBe("10:00");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fake.view.days[0].places[1].time).toBe("10:00");
  });

  it("finishing a time edit keeps telling others the open place is being edited", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "A", category: "sight", dayId: dayIds[0], time: "09:00" }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(within(row("A")).getByRole("button", { name: "A" }));
    expect(fake.awareness.getLocalState()?.editing).toBe(id);
    fireEvent.click(screen.getByRole("button", { name: "Change the time for A, now 09:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time for A" }), { target: { value: "09:30" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time for A" }), { key: "Enter" });
    expect(fake.awareness.getLocalState()?.editing).toBe(id);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(fake.awareness.getLocalState()?.editing).toBeNull();
  });

  it("a late line names an unnamed previous stop", () => {
    const { doc, dayIds } = newTrip();
    const first = addPlace(doc, { name: "Temp", category: "sight", stayMinutes: 120, dayId: dayIds[0], time: "09:00" }, "u1");
    addPlace(doc, { name: "Lunch", category: "food", dayId: dayIds[0], time: "10:00" }, "u1");
    (doc.getMap("places").get(first) as Y.Map<unknown>).set("name", "");
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(row("Lunch")).getByText("You'd arrive ≈ 60 min late (from Unnamed place)")).toBeTruthy();
  });
  it("leaving an untouched estimate does not pin it; clearing a time is announced", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "A", category: "sight", stayMinutes: 60, dayId: dayIds[0], time: "09:00" }, "u1");
    addPlace(doc, { name: "B", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Set a time for B, estimated 10:00" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Time for B" }));
    expect(screen.queryByRole("textbox", { name: "Time for B" })).toBeNull();
    expect(fake.view.days[0].places[1].time).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change the time for A, now 09:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time for A" }), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time for A" }), { key: "Enter" });
    expect(fake.view.days[0].places[0].time).toBeNull();
    expect(screen.getByTestId("plan-status").textContent).toBe("A has no set time");
  });
});

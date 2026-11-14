import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { addPlace, initTrip, readTrip } from "@rota/trip";
import { MAP_STYLE, MapLoaderContext } from "@/components/map/engine";
import { DAY_COLOURS } from "@/components/map/mapFeatures";
import { LONG_PRESS_MS, TripMap, type MapShown } from "@/components/map/TripMap";
import { renderIntl } from "../components/helpers";
import { fakeMap } from "./fakeMap";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function trip() {
  const doc = new Y.Doc();
  initTrip(doc, { name: "Istanbul", startDate: "2026-11-27", days: 2, locale: "en" }, "seed");
  const dayIds = readTrip(doc).days.map((d) => d.id);
  const tower = addPlace(
    doc,
    {
      name: "Galata Tower",
      category: "sight",
      dayId: dayIds[0],
      lat: 41.0256,
      lng: 28.9742,
    },
    "u1",
  );
  const lokanta = addPlace(
    doc,
    {
      name: "Karaköy Lokantası",
      category: "food",
      dayId: dayIds[0],
      lat: 41.0228,
      lng: 28.9779,
    },
    "u1",
  );
  const loti = addPlace(
    doc,
    {
      name: "Pierre Loti",
      category: "cafe",
      dayId: null,
      lat: 41.0536,
      lng: 28.9338,
    },
    "u1",
  );
  return { doc, view: readTrip(doc), dayIds, tower, lokanta, loti };
}

function setup(overrides: Partial<Parameters<typeof TripMap>[0]> = {}, map: Parameters<typeof fakeMap>[0] = {}) {
  const { view, dayIds, ...ids } = trip();
  const fake = fakeMap(map);
  const props = {
    view,
    hiddenIds: new Set<string>(),
    shown: { kind: "day", dayId: dayIds[0] } as MapShown,
    selectedPlaceId: null as string | null,
    panel: false,
    onSelectPlace: vi.fn(),
    awareness: null,
    userId: "u1",
    add: {
      lists: [
        { id: dayIds[0], label: "Day 1" },
        { id: dayIds[1], label: "Day 2" },
        { id: null, label: "Ideas" },
      ],
      onAdd: vi.fn(),
    },
    sheet: null,
    ...overrides,
  };
  const ui = (p: typeof props) => (
    <MapLoaderContext.Provider value={fake.load}>
      <TripMap {...p} />
    </MapLoaderContext.Provider>
  );
  const r = renderIntl(ui(props));
  return {
    ...r,
    fake,
    props,
    dayIds,
    ...ids,
    rerenderWith: (p: Partial<typeof props>) => r.rerender(ui({ ...props, ...p })),
  };
}

const pins = () => [...document.querySelectorAll<HTMLElement>("[data-pin]")];
const labels = () => [...document.querySelectorAll<HTMLElement>("[data-pin-label]")].map((l) => l.textContent);
const pinOf = (id: string) => document.querySelector<HTMLElement>(`[data-pin="${id}"]`)!;
/** Zoomed in to street level: 20 000 px a degree puts Galata Tower and Karaköy Lokantası about 90 px apart. */
const street = { zoom: 15, scale: 20000 };

describe("TripMap", () => {
  it("map uses the positron style", () => {
    expect(MAP_STYLE).toBe("https://tiles.openfreemap.org/styles/positron");
  });

  it("opens on the day shown with its numbered pins and route, and is removed with the screen", async () => {
    const { fake, unmount, tower, lokanta } = setup();
    await waitFor(() => expect(pins()).toHaveLength(2));
    // Opened on the day's pins, then fitted again with room for the controls (at once, no animation).
    expect(fake.state.start?.bounds).toEqual([28.9742, 41.0228, 28.9779, 41.0256]);
    expect(fake.state.fits).toEqual([[28.9742, 41.0228, 28.9779, 41.0256]]);
    expect(fake.state.fitOptions[0].animate).toBe(false);
    // Only that day's pins: Ideas are not on a day's map.
    expect(pins().map((p) => [p.dataset.pin, p.textContent])).toEqual([
      [tower, "1"],
      [lokanta, "2"],
    ]);
    expect(pins()[0].querySelector<HTMLElement>("[data-pin-head]")!.style.background).toBe("rgb(30, 58, 138)");
    expect(fake.state.routes).toEqual([expect.objectContaining({ colour: DAY_COLOURS[0], approximate: true })]);
    unmount();
    expect(fake.state.removed).toBe(true);
  });

  it("follows the view: Ideas show idea pins, the whole trip everything, each change fitted", async () => {
    const { fake, rerenderWith, loti } = setup();
    await waitFor(() => expect(pins()).toHaveLength(2));
    rerenderWith({ shown: { kind: "ideas" } });
    expect(pins().map((p) => p.dataset.pin)).toEqual([loti]);
    expect(pins()[0].dataset.idea).toBe("true");
    expect(fake.state.routes).toEqual([]);
    expect(fake.state.fits.at(-1)).toEqual([28.9338, 41.0536, 28.9338, 41.0536]);
    expect(fake.state.fitOptions.at(-1)!.animate).toBe(true);
    rerenderWith({ shown: { kind: "all" } });
    expect(pins()).toHaveLength(3);
    expect(fake.state.fits).toHaveLength(3);
  });

  it("fits without animation under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") || query.includes("min-width"), media: query }) as MediaQueryList);
    const { fake, rerenderWith } = setup();
    await waitFor(() => expect(pins()).toHaveLength(2));
    rerenderWith({ shown: { kind: "all" } });
    expect(fake.state.fitOptions.map((o) => o.animate)).toEqual([false, false]);
    vi.unstubAllGlobals();
  });

  it("selected pin is emphasised", async () => {
    const { rerenderWith, tower, lokanta } = setup();
    await waitFor(() => expect(pins()).toHaveLength(2));
    const head = (id: string) => document.querySelector<HTMLElement>(`[data-pin="${id}"] [data-pin-head]`)!;
    expect(head(tower).className).toContain("size-[34px]");
    rerenderWith({ selectedPlaceId: tower });
    expect(document.querySelector<HTMLElement>(`[data-pin="${tower}"]`)!.dataset.selected).toBe("true");
    expect(head(tower).className).toContain("size-[42px]");
    // A halo in the day's colour.
    expect(head(tower).style.boxShadow).toContain("rgba(30, 58, 138, 0.25) 0px 0px 0px 5px");
    expect(head(lokanta).className).toContain("size-[34px]");
    expect(document.querySelector<HTMLElement>(`[data-pin="${lokanta}"]`)!.dataset.selected).toBeUndefined();
  });

  it("a pin selects its place, shows its name on hover, and a place out of view is brought in", async () => {
    const { fake, props, rerenderWith, lokanta, loti } = setup({ shown: { kind: "all" } });
    await waitFor(() => expect(pins()).toHaveLength(3));
    fireEvent.click(pins()[1]);
    expect(props.onSelectPlace).toHaveBeenCalledWith(lokanta);
    // Hovering a pin shows a small name card.
    expect(screen.queryByText("Karaköy Lokantası")).toBeNull();
    fireEvent.pointerEnter(pins()[1], { pointerType: "mouse" });
    expect(screen.getByText("Karaköy Lokantası")).toBeTruthy();
    fireEvent.pointerLeave(pins()[1]);
    expect(screen.queryByText("Karaköy Lokantası")).toBeNull();

    // Pierre Loti (lng 28.93, lat 41.05) is in this view; after panning away it is not.
    rerenderWith({ shown: { kind: "all" }, selectedPlaceId: loti });
    expect(fake.state.centred).toHaveLength(0);
    act(() => fake.pan({ lng: 30, lat: 42 }));
    rerenderWith({ shown: { kind: "all" }, selectedPlaceId: null });
    rerenderWith({ shown: { kind: "all" }, selectedPlaceId: loti });
    expect(fake.state.centred).toEqual([expect.objectContaining({ lat: 41.0536, lng: 28.9338 })]);
  });

  it("a search result's preview pin: drawn locally, brought into view only when off-screen, removed when cleared", async () => {
    const { fake, rerenderWith } = setup();
    await waitFor(() => expect(pins()).toHaveLength(2));
    const preview = () => [...document.querySelectorAll<HTMLElement>("[data-preview-pin]")];
    expect(preview()).toHaveLength(0);
    // On screen: shown where it is, no camera move.
    rerenderWith({ preview: { name: "Pera Müzesi", category: "museum", lat: 41.0317, lng: 28.9752 } });
    expect(preview().map((p) => p.dataset.previewPin)).toEqual(["Pera Müzesi"]);
    expect(preview()[0].getAttribute("aria-hidden")).toBe("true");
    expect(fake.state.centred).toHaveLength(0);
    // Off screen (far east of the view): the map goes to it.
    rerenderWith({ preview: { name: "Far away", category: "sight", lat: 41.5, lng: 37 } });
    expect(preview().map((p) => p.dataset.previewPin)).toEqual(["Far away"]);
    expect(fake.state.centred).toEqual([{ lat: 41.5, lng: 37 }]);
    rerenderWith({ preview: null });
    expect(preview()).toHaveLength(0);
    // Not a place: the trip's own pins are untouched.
    expect(pins()).toHaveLength(2);
  });

  it("no day chips on the map, and fits leave room for the open details panel on wide screens", async () => {
    const { fake, rerenderWith } = setup();
    await waitFor(() => expect(pins()).toHaveLength(2));
    // The rail chooses the day; nothing focusable sits on the map's left edge, under the panel.
    expect(screen.queryByRole("group", { name: "Day shown on the map" })).toBeNull();
    expect(fake.state.fitOptions[0].padding.left).toBeLessThan(100);
    rerenderWith({ panel: true });
    fireEvent.click(screen.getByRole("button", { name: "Fit the map to the places" }));
    expect(fake.state.fitOptions.at(-1)!.padding.left).toBeGreaterThanOrEqual(340);
  });

  it("a narrow map (a 1024 px window) keeps room to fit beside the open panel", async () => {
    // At 1024 px the map column is about 416 px wide: the panel's padding alone would exceed it.
    const { fake, rerenderWith } = setup({ panel: true }, { width: 416 });
    await waitFor(() => expect(pins()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Fit the map to the places" }));
    for (const { padding } of fake.state.fitOptions) {
      expect(padding.left).toBeGreaterThanOrEqual(32);
      expect(416 - padding.left - padding.right).toBeGreaterThanOrEqual(120);
    }
    rerenderWith({ panel: true, shown: { kind: "all" } });
    const { padding } = fake.state.fitOptions.at(-1)!;
    expect(416 - padding.left - padding.right).toBeGreaterThanOrEqual(120);
  });

  it("the hover card is for mouse and pen, not touch", async () => {
    setup();
    await waitFor(() => expect(pins()).toHaveLength(2));
    fireEvent.pointerEnter(pins()[0], { pointerType: "touch" });
    expect(screen.queryByText("Galata Tower")).toBeNull();
    fireEvent.pointerEnter(pins()[0], { pointerType: "pen" });
    expect(screen.getByText("Galata Tower")).toBeTruthy();
  });

  it("right-click or a long-press adds a place there", async () => {
    const { props, dayIds } = setup();
    await waitFor(() => expect(pins()).toHaveLength(2));
    const surface = document.querySelector<HTMLElement>(".absolute.inset-0")!;

    // Right-click at (100, 90): lng 29, lat 41.1.
    fireEvent.contextMenu(surface, { clientX: 100, clientY: 90 });
    const dialog = await screen.findByRole("dialog", {
      name: "Add a place here",
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Enter a name.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Place name"), {
      target: { value: "Ferry pier" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Sight" }));
    // Into a day it asks the time (no suggestion here: empty, so untimed) and the stay (the category's).
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Stay (minutes)") as HTMLInputElement).value).toBe("45");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(props.add!.onAdd).toHaveBeenCalledWith({
      name: "Ferry pier",
      category: "sight",
      dayId: dayIds[0],
      lng: 29,
      lat: 41.1,
      time: null,
      stayMinutes: 45,
    });
    expect(dialog.isConnected).toBe(false);

    // A finger resting 500 ms; one that moves is panning.
    vi.useFakeTimers();
    fireEvent.pointerDown(surface, {
      pointerType: "touch",
      isPrimary: true,
      clientX: 200,
      clientY: 100,
    });
    fireEvent.pointerMove(surface, {
      pointerType: "touch",
      clientX: 240,
      clientY: 100,
    });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.pointerDown(surface, {
      pointerType: "touch",
      isPrimary: true,
      clientX: 200,
      clientY: 100,
    });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(screen.getByRole("dialog", { name: "Add a place here" })).toBeTruthy();
    expect(screen.getByText("41.00000, 30.00000")).toBeTruthy();
  });

  it("without editing, the map adds nothing", async () => {
    setup({ add: null });
    await waitFor(() => expect(pins()).toHaveLength(2));
    fireEvent.contextMenu(document.querySelector<HTMLElement>(".absolute.inset-0")!, { clientX: 100, clientY: 90 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("publishes this person's pointer and shows friends' cursors", async () => {
    const awareness = new Awareness(new Y.Doc());
    awareness.setLocalState({
      user: { id: "u1", name: "Ann", colour: "#2563eb" },
      editing: null,
      cursor: null,
    });
    const { fake, unmount } = setup({ awareness });
    await waitFor(() => expect(pins()).toHaveLength(2));
    const surface = document.querySelector<HTMLElement>(".absolute.inset-0")!;

    fireEvent.pointerMove(surface, {
      pointerType: "mouse",
      clientX: 100,
      clientY: 90,
    });
    expect(awareness.getLocalState()?.cursor).toEqual({ lng: 29, lat: 41.1 });

    // A friend's cursor, where they point; hidden when that is outside this view; gone when they leave.
    const friend = new Awareness(new Y.Doc());
    const relay = () => act(() => applyAwarenessUpdate(awareness, encodeAwarenessUpdate(friend, [friend.clientID]), "remote"));
    friend.setLocalState({
      user: { id: "u2", name: "Deniz", colour: "#ea580c" },
      editing: null,
      cursor: { lat: 41.5, lng: 29.5 },
    });
    relay();
    const cursor = document.querySelector<HTMLElement>('[data-cursor="u2"]')!;
    expect(cursor.textContent).toBe("Deniz");
    expect(cursor.style.transform).toBe("translate(150px, 50px)");
    expect(cursor.hidden).toBe(false);
    act(() => fake.pan({ lng: 30, lat: 42 }));
    expect(cursor.hidden).toBe(true);
    friend.setLocalState({
      user: { id: "u2", name: "Deniz", colour: "#ea580c" },
      editing: null,
      cursor: null,
    });
    relay();
    expect(document.querySelector('[data-cursor="u2"]')).toBeNull();

    // Leaving the map clears this person's cursor (after the throttle window); unmounting too.
    vi.useFakeTimers();
    fireEvent.pointerLeave(surface.parentElement!);
    act(() => vi.advanceTimersByTime(100));
    expect(awareness.getLocalState()?.cursor).toBeNull();
    fireEvent.pointerMove(surface, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    expect(awareness.getLocalState()?.cursor).not.toBeNull();
    unmount();
    expect(awareness.getLocalState()?.cursor).toBeNull();
    awareness.destroy();
    friend.destroy();
  });

  it("pins show a short name label when zoomed in and apart; none when zoomed out, except the selected pin's", async () => {
    const { fake, rerenderWith, tower } = setup({}, street);
    await waitFor(() => expect(labels()).toEqual(["Galata Tower", "Karaköy Lokantası"]));
    // Visual only, like the pins.
    expect(pinOf(tower).getAttribute("aria-hidden")).toBe("true");
    act(() => fake.zoomTo(10));
    await waitFor(() => expect(labels()).toEqual([]));
    rerenderWith({ selectedPlaceId: tower });
    expect(labels()).toEqual(["Galata Tower"]);
    act(() => fake.zoomTo(15));
    await waitFor(() => expect(labels()).toHaveLength(2));
  });

  it("a long name is cut on its label, the full name in the hover card", async () => {
    const { doc, dayIds } = trip();
    addPlace(doc, { name: "Kadıköy Barlar Sokağı", category: "drinks", dayId: dayIds[1], lat: 41.0, lng: 29.03 }, "u1");
    setup({ view: readTrip(doc), shown: { kind: "all" } }, street);
    await waitFor(() => expect(labels()).toContain("Kadıköy Barlar So…"));
    const long = pins().find((p) => p.textContent?.includes("Kadıköy Barlar So…"))!;
    fireEvent.pointerEnter(long, { pointerType: "mouse" });
    expect(screen.getByText("Kadıköy Barlar Sokağı")).toBeTruthy();
  });

  it("hovering a pin reports it, and the pin of a hovered row is highlighted with its label", async () => {
    const onHoverPlace = vi.fn();
    const { rerenderWith, tower, lokanta } = setup({ onHoverPlace });
    await waitFor(() => expect(pins()).toHaveLength(2));
    fireEvent.pointerEnter(pinOf(tower), { pointerType: "mouse" });
    expect(onHoverPlace).toHaveBeenLastCalledWith(tower);
    fireEvent.pointerLeave(pinOf(tower));
    expect(onHoverPlace).toHaveBeenLastCalledWith(null);
    // A finger has no hover.
    onHoverPlace.mockClear();
    fireEvent.pointerEnter(pinOf(tower), { pointerType: "touch" });
    expect(onHoverPlace).not.toHaveBeenCalled();

    rerenderWith({ onHoverPlace, hoveredPlaceId: lokanta });
    expect(pinOf(lokanta).dataset.hovered).toBe("true");
    expect(pinOf(tower).dataset.hovered).toBeUndefined();
    // Zoomed out, but the hovered pin's label shows.
    expect(labels()).toEqual(["Karaköy Lokantası"]);
  });

  it("a click on the empty map is reported; a click on a pin, or the end of a pan, is not", async () => {
    const onMapClick = vi.fn();
    const { fake } = setup({ onMapClick });
    await waitFor(() => expect(pins()).toHaveLength(2));
    const surface = fake.state.container!;
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerType: "mouse" });
    fireEvent.click(surface, { clientX: 10, clientY: 10 });
    expect(onMapClick).toHaveBeenCalledTimes(1);
    fireEvent.click(pins()[0]);
    expect(onMapClick).toHaveBeenCalledTimes(1);
    // A drag that pans the map ends with a click too: not an empty-map click.
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerType: "mouse" });
    fireEvent.click(surface, { clientX: 90, clientY: 60 });
    expect(onMapClick).toHaveBeenCalledTimes(1);
  });
});

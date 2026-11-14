import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { addPlace, initTrip, readTrip } from "@rota/trip";
import { MapLoaderContext } from "@/components/map/engine";
import { DAY_COLOURS } from "@/components/map/mapFeatures";
import { LONG_PRESS_MS, TripMap } from "@/components/map/TripMap";
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

function setup(overrides: Partial<Parameters<typeof TripMap>[0]> = {}) {
  const { view, dayIds, ...ids } = trip();
  const fake = fakeMap();
  const props = {
    view,
    hiddenIds: new Set<string>(),
    selectedDayId: dayIds[0] as string | null,
    selectedPlaceId: null as string | null,
    onSelectDay: vi.fn(),
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

describe("TripMap", () => {
  it("opens on the trip with its pins and the day's route, and is removed with the screen", async () => {
    const { fake, unmount, tower, lokanta, loti } = setup();
    await waitFor(() => expect(pins()).toHaveLength(3));
    // Opened on the day's pins, then fitted again with room for the controls.
    expect(fake.state.start?.bounds).toEqual([28.9742, 41.0228, 28.9779, 41.0256]);
    expect(fake.state.fits).toEqual([[28.9742, 41.0228, 28.9779, 41.0256]]);
    expect(pins().map((p) => [p.dataset.pin, p.textContent])).toEqual([
      [tower, "1"],
      [lokanta, "2"],
      [loti, ""],
    ]);
    expect(pins()[0].style.background).toBe("rgb(30, 58, 138)");
    expect(fake.state.route).toMatchObject({
      colour: DAY_COLOURS[0],
      approximate: true,
    });
    unmount();
    expect(fake.state.removed).toBe(true);
  });

  it("a pin selects its place; selecting a day fits it; a place out of view is brought in", async () => {
    const { fake, props, rerenderWith, dayIds, lokanta, loti } = setup();
    await waitFor(() => expect(pins()).toHaveLength(3));
    fireEvent.click(pins()[1]);
    expect(props.onSelectPlace).toHaveBeenCalledWith(lokanta);
    fireEvent.click(screen.getByRole("button", { name: "Day 2", pressed: false }));
    expect(props.onSelectDay).toHaveBeenCalledWith(dayIds[1]);
    expect(screen.getByRole("group", { name: "Day shown on the map" })).toBeTruthy();

    rerenderWith({ selectedDayId: null });
    expect(fake.state.fits).toHaveLength(2);
    // Pierre Loti (lng 28.93, lat 41.05) is in this view; after panning away it is not.
    rerenderWith({ selectedDayId: null, selectedPlaceId: loti });
    expect(fake.state.centred).toHaveLength(0);
    act(() => fake.pan({ lng: 30, lat: 42 }));
    rerenderWith({ selectedDayId: null, selectedPlaceId: null });
    rerenderWith({ selectedDayId: null, selectedPlaceId: loti });
    expect(fake.state.centred).toEqual([expect.objectContaining({ lat: 41.0536, lng: 28.9338 })]);
  });

  it("right-click or a long-press adds a place there", async () => {
    const { props, dayIds } = setup();
    await waitFor(() => expect(pins()).toHaveLength(3));
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
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(props.add!.onAdd).toHaveBeenCalledWith({
      name: "Ferry pier",
      category: "sight",
      dayId: dayIds[0],
      lng: 29,
      lat: 41.1,
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
    await waitFor(() => expect(pins()).toHaveLength(3));
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
    await waitFor(() => expect(pins()).toHaveLength(3));
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
});

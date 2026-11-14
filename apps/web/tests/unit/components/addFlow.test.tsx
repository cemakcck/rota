import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as Y from "yjs";
import { addPlace, updatePlace } from "@rota/trip";
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

const at = (search: string) => window.history.replaceState(null, "", `/en/t/t1${search}`);
beforeEach(() => at(""));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  at("");
});

const pera = { name: "Pera Müzesi", label: "Meşrutiyet Caddesi 65, Beyoğlu", lat: 41.0317, lng: 28.9752, osmId: "n12", category: "museum" };
const camlica = { name: "Çamlıca Kulesi", label: "Üsküdar", lat: 41.0274, lng: 29.0686, osmId: "n13", category: "sight" };

const search = () => screen.getByRole("combobox", { name: /^Add a place to/ });
const names = () => screen.queryAllByTestId("place-name").map((e) => e.textContent);
const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
const nameButton = (name: string) => within(row(name)).getByRole("button", { name });
const step = () => screen.getByRole("form", { name: /^Add / });
const offline = () => vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

/** A day with breakfast at Galata at 09:00 for an hour: the next stop is suggested at 10:00. */
function withBreakfast() {
  const made = newTrip();
  const galata = addPlace(made.doc, { name: "Breakfast", category: "food", stayMinutes: 60, dayId: made.dayIds[0], time: "09:00", lat: 41.0256, lng: 28.9742 }, "u1");
  return { ...made, galata };
}

/** Types into the search and opens the add step for the typed name (offline: no results). */
function stepFor(name: string) {
  fireEvent.change(search(), { target: { value: name } });
  fireEvent.keyDown(search(), { key: "Enter" });
  return step();
}

function touch(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: coarse && query.includes("pointer: coarse"), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
}

describe("add-place flow", () => {
  it("results show the category icon, name, short address and the distance from the day's last stop", async () => {
    withBreakfast();
    const { fn } = stubFetch({ "GET /api/geocode?q=Pera&lang=en&lat=41.03&lng=28.97": () => ({ body: { results: [pera, camlica] } }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);

    fireEvent.change(search(), { target: { value: "Pera" } });
    const list = await screen.findByRole("listbox");
    const [first, second] = within(list).getAllByRole("option");
    expect(within(first).getByRole("img", { name: "Museum" })).toBeTruthy();
    expect(within(first).getByText("Pera Müzesi")).toBeTruthy();
    expect(within(first).getByText(pera.label)).toBeTruthy();
    // From Breakfast (Galata): about 680 m; Çamlıca is across the water, kilometres away.
    expect(within(first).getByTestId("result-distance").textContent).toBe("680 m");
    expect(within(second).getByTestId("result-distance").textContent).toBe("7.9 km");
    // Wider than the field, so names and addresses fit.
    expect(list.className).toContain("min-w-[min(360px");
  });

  it("arrowing or hovering a result shows a preview pin on the map, leaving removes it, and nothing is saved", async () => {
    const { doc } = withBreakfast();
    const { fn } = stubFetch({ "GET /api/geocode?q=Pera&lang=en&lat=41.03&lng=28.97": () => ({ body: { results: [pera, camlica] } }) });
    vi.stubGlobal("fetch", fn);
    const map = fakeMap();
    renderIntl(
      <MapLoaderContext.Provider value={map.load}>
        <TripScreen tripId="t1" />
      </MapLoaderContext.Provider>,
    );
    await waitFor(() => expect(document.querySelectorAll("[data-pin]")).toHaveLength(1));
    const before = Y.encodeStateVector(doc);
    const preview = () => document.querySelectorAll<HTMLElement>("[data-preview-pin]");

    fireEvent.change(search(), { target: { value: "Pera" } });
    const options = await screen.findAllByRole("option");
    expect(preview()).toHaveLength(0);
    fireEvent.mouseEnter(options[1]);
    await waitFor(() => expect(preview()).toHaveLength(1));
    expect(preview()[0].dataset.previewPin).toBe("Çamlıca Kulesi");
    fireEvent.mouseLeave(options[1]);
    await waitFor(() => expect(preview()).toHaveLength(0));

    fireEvent.keyDown(search(), { key: "ArrowDown" });
    await waitFor(() => expect(preview()).toHaveLength(1));
    expect(preview()[0].dataset.previewPin).toBe("Pera Müzesi");
    fireEvent.keyDown(search(), { key: "Escape" });
    await waitFor(() => expect(preview()).toHaveLength(0));
    // A local layer only: the shared trip did not change.
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(fake.view.days[0].places).toHaveLength(1);
  });

  it("time picker: the suggestion is the default, ±30 minutes, No set time, and invalid input is refused", () => {
    withBreakfast();
    offline();
    renderIntl(<TripScreen tripId="t1" />);

    const form = stepFor("Galata Tower");
    const time = within(form).getByLabelText("Time") as HTMLInputElement;
    expect(time.type).toBe("text");
    expect(time.value).toBe("10:00");
    const suggested = within(form).getByRole("button", { name: "Suggested 10:00" });
    expect(suggested.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(form).getByRole("button", { name: "30 minutes later" }));
    expect(time.value).toBe("10:30");
    expect(suggested.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(form).getByRole("button", { name: "30 minutes earlier" }));
    fireEvent.click(within(form).getByRole("button", { name: "30 minutes earlier" }));
    expect(time.value).toBe("09:30");

    const none = within(form).getByRole("button", { name: "No set time" });
    fireEvent.click(none);
    expect(time.value).toBe("");
    expect(none.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(suggested);
    expect(time.value).toBe("10:00");
    expect(none.getAttribute("aria-pressed")).toBe("false");

    // Never past the day's ends.
    fireEvent.change(time, { target: { value: "23:45" } });
    fireEvent.click(within(form).getByRole("button", { name: "30 minutes later" }));
    expect(time.value).toBe("23:59");
    fireEvent.change(time, { target: { value: "00:10" } });
    fireEvent.click(within(form).getByRole("button", { name: "30 minutes earlier" }));
    expect(time.value).toBe("00:00");

    fireEvent.change(time, { target: { value: "25:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add to Day 1" }));
    expect(time.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a time like 09:30, or leave it empty.")).toBeTruthy();
    expect(fake.view.days[0].places).toHaveLength(1);

    // No set time: added untimed.
    fireEvent.click(within(form).getByRole("button", { name: "No set time" }));
    fireEvent.click(within(form).getByRole("button", { name: "Add to Day 1" }));
    expect(fake.view.days[0].places.map((p) => [p.name, p.time])).toEqual([
      ["Breakfast", "09:00"],
      ["Galata Tower", null],
    ]);
  });

  it("time picker uses the device's own time input on touch screens", () => {
    withBreakfast();
    offline();
    touch(true);
    renderIntl(<TripScreen tripId="t1" />);
    const time = within(stepFor("Galata Tower")).getByLabelText("Time") as HTMLInputElement;
    expect(time.type).toBe("time");
    expect(time.value).toBe("10:00");
    fireEvent.change(time, { target: { value: "11:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Day 1" }));
    expect(fake.view.days[0].places.at(-1)).toMatchObject({ name: "Galata Tower", time: "11:15" });
  });

  it("stay chips: the category's usual stay is chosen, a chip changes it, Custom… takes minutes", () => {
    newTrip();
    offline();
    renderIntl(<TripScreen tripId="t1" />);

    const form = stepFor("Market");
    const stay = within(form).getByRole("group", { name: "Stay" });
    const chips = within(stay).getAllByRole("button").map((b) => b.textContent);
    expect(chips).toEqual(["15 min", "30 min", "1 h", "1 h 30 min", "2 h", "3 h", "Custom…"]);
    // "Other": an hour.
    expect(within(stay).getByRole("button", { name: "1 h" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(form).queryByLabelText("Stay (minutes)")).toBeNull();

    fireEvent.click(within(stay).getByRole("button", { name: "30 min" }));
    expect(within(stay).getByRole("button", { name: "30 min" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(stay).getByRole("button", { name: "1 h" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(within(stay).getByRole("button", { name: "Custom…" }));
    const minutes = within(form).getByLabelText("Stay (minutes)") as HTMLInputElement;
    expect(document.activeElement).toBe(minutes);
    expect(minutes.value).toBe("30");
    expect([minutes.min, minutes.max, minutes.step]).toEqual(["0", "1440", "5"]);
    fireEvent.change(minutes, { target: { value: "50" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add to Day 1" }));
    expect(fake.view.days[0].places[0]).toMatchObject({ name: "Market", stayMinutes: 50 });
  });

  it("the category is shown in the step, suggested by the result, and can be changed there", async () => {
    newTrip();
    const { fn } = stubFetch({ "GET /api/geocode?q=Pera&lang=en": () => ({ body: { results: [pera] } }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripScreen tripId="t1" />);

    fireEvent.change(search(), { target: { value: "Pera" } });
    fireEvent.click(await screen.findByRole("option", { name: /Pera Müzesi/ }));
    const form = step();
    const category = within(form).getByLabelText("Category") as HTMLSelectElement;
    expect(category.value).toBe("museum");
    expect(within(within(form).getByRole("group", { name: "Stay" })).getByRole("button", { name: "2 h" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(category, { target: { value: "cafe" } });
    // The stay follows the category until it is chosen: a café's 45 minutes.
    expect((within(form).getByLabelText("Stay (minutes)") as HTMLInputElement).value).toBe("45");
    fireEvent.click(within(form).getByRole("button", { name: "Add to Day 1" }));
    expect(fake.view.days[0].places[0]).toMatchObject({ name: "Pera Müzesi", category: "cafe", stayMinutes: 45 });
  });

  it("after adding: the search clears, the new row is focused and highlighted, and a toast offers Undo", async () => {
    withBreakfast();
    offline();
    renderIntl(<TripScreen tripId="t1" />);

    stepFor("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Add to Day 1" }));
    expect((search() as HTMLInputElement).value).toBe("");
    expect(names()).toEqual(["Breakfast", "Galata Tower"]);
    await waitFor(() => expect(document.activeElement).toBe(nameButton("Galata Tower")));
    expect(row("Galata Tower").dataset.highlighted).toBe("true");
    expect(row("Breakfast").dataset.highlighted).toBeUndefined();

    // Said politely, and focusable (but focus stays on the new row).
    const status = screen.getByText("Added to Day 1 at 10:00").closest("[role=status]");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    const undo = screen.getByRole("button", { name: "Undo adding Galata Tower" });
    expect(document.activeElement).not.toBe(undo);
    fireEvent.click(undo);
    expect(names()).toEqual(["Breakfast"]);
    expect(screen.queryByText("Added to Day 1 at 10:00")).toBeNull();
  });

  it("the highlight fades after about 2 s, and an untimed add says so", async () => {
    vi.useFakeTimers();
    newTrip();
    offline();
    renderIntl(<TripScreen tripId="t1" />);
    const form = stepFor("Galata Tower");
    fireEvent.click(within(form).getByRole("button", { name: "No set time" }));
    fireEvent.click(within(form).getByRole("button", { name: "Add to Day 1" }));
    expect(screen.getByText("Added to Day 1")).toBeTruthy();
    expect(row("Galata Tower").dataset.highlighted).toBe("true");
    act(() => vi.advanceTimersByTime(2100));
    expect(row("Galata Tower").dataset.highlighted).toBeUndefined();
    // The toast lasts 6 s.
    expect(screen.getByText("Added to Day 1")).toBeTruthy();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("Added to Day 1")).toBeNull();
  });

  it("Undo after adding removes only this person's place, even after a friend's edits meanwhile", () => {
    const { galata } = withBreakfast();
    offline();
    renderIntl(<TripScreen tripId="t1" />);
    stepFor("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Add to Day 1" }));
    const added = fake.view.days[0].places.find((p) => p.name === "Galata Tower")!.id;

    // Deniz renames Breakfast and changes the new stop's stay.
    act(() => {
      updatePlace(fake.doc, galata, { name: "Simit breakfast" }, "u2");
      updatePlace(fake.doc, added, { stayMinutes: 30 }, "u2");
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo adding Galata Tower" }));
    expect(fake.view.days[0].places.map((p) => p.name)).toEqual(["Simit breakfast"]);
  });

  it("adding to Ideas from a day keeps focus in the search and says where it went", () => {
    newTrip();
    offline();
    renderIntl(<TripScreen tripId="t1" />);
    stepFor("Balat");
    fireEvent.click(screen.getByRole("button", { name: "Add to Ideas" }));
    expect(fake.view.ideas.map((p) => p.name)).toEqual(["Balat"]);
    expect(screen.getByText("Added to Ideas")).toBeTruthy();
    expect(document.activeElement).toBe(search());
  });
});

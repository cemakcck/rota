import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addPlace, createUndo, setPlaceStatus, vote } from "@rota/trip";
import { renderIntl } from "./helpers";
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

beforeEach(() => window.history.replaceState(null, "", "/en/t/t1?view=ideas"));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const ideasRegion = () => screen.getByRole("region", { name: "Ideas" });
const names = (region: HTMLElement) => within(region).queryAllByTestId("place-name").map((e) => e.textContent);

describe("ideas view", () => {
  it("ideas view lists ideas and suggestions with votes and accept/dismiss", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Pierre Loti", category: "cafe", dayId: null, stayMinutes: 45 }, "u1");
    addPlace(doc, { name: "Balat", category: "sight", dayId: null }, "u2");
    const moda = addPlace(doc, { name: "Moda Sahil", category: "nature", dayId: null, status: "suggested" }, "u2");
    vote(doc, moda, "u2", 1);
    const old = addPlace(doc, { name: "Old idea", category: "food", dayId: null, status: "suggested" }, "u2");
    setPlaceStatus(doc, old, "dismissed", "u2");
    renderIntl(<TripScreen tripId="t1" />);

    // The list column is Ideas & votes: no day header, no day's stops.
    expect(screen.queryByRole("region", { name: /^Day 1\b/ })).toBeNull();
    expect(screen.queryByText("Galata Tower")).toBeNull();
    expect(screen.getByRole("combobox", { name: /^Add a place to Ideas/ })).toBeTruthy();

    // Ideas as rows, each with Add to day…; no time on an idea's row.
    expect(names(ideasRegion())).toEqual(["Pierre Loti", "Balat"]);
    const loti = screen.getByText("Pierre Loti", { selector: "[data-testid=place-name]" }).closest("li")!;
    expect(within(loti).getByRole("button", { name: "Add Pierre Loti to a day" }).textContent).toBe("Add to day…");
    expect(within(loti).queryByTestId("place-time")).toBeNull();
    // Its stay stays on the row, beside Add to day….
    expect(within(loti).getByText("45 min")).toBeTruthy();

    // Suggestions with their score, votes, Accept and Dismiss; dismissed ones behind a disclosure.
    const suggestions = screen.getByRole("region", { name: "Suggestions" });
    expect(within(suggestions).getByText("Score 1")).toBeTruthy();
    expect(within(suggestions).getByRole("button", { name: "Upvote Moda Sahil" })).toBeTruthy();
    expect(within(suggestions).getByRole("button", { name: "Downvote Moda Sahil" })).toBeTruthy();
    expect(within(suggestions).getByRole("button", { name: "Accept Moda Sahil" })).toBeTruthy();
    expect(within(suggestions).getByRole("button", { name: "Dismiss Moda Sahil" })).toBeTruthy();
    const toggle = within(suggestions).getByRole("button", { name: /Dismissed/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(within(suggestions).getByRole("button", { name: "Restore Old idea" })).toBeTruthy();
  });

  it("adding to a day from ideas moves the place and switches nothing else", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Breakfast", category: "food", dayId: dayIds[0], time: "08:30", stayMinutes: 60 }, "u1");
    const loti = addPlace(doc, { name: "Pierre Loti", category: "cafe", dayId: null, stayMinutes: 45 }, "u1");
    addPlace(doc, { name: "Balat", category: "sight", dayId: null }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    fireEvent.click(screen.getByRole("button", { name: "Add Pierre Loti to a day" }));
    const form = screen.getByRole("form", { name: "Add Pierre Loti to a day" });
    const dayField = within(form).getByRole("combobox", { name: "Day" });
    const time = within(form).getByRole("textbox", { name: "Time" });
    // The first day, its time suggested after its last stop (08:30 + 1 h, no travel known).
    expect((dayField as HTMLSelectElement).value).toBe(dayIds[0]);
    expect((time as HTMLInputElement).value).toBe("09:30");
    expect((within(form).getByRole("spinbutton", { name: "Stay (minutes)" }) as HTMLInputElement).value).toBe("45");
    // A day with nothing timed: no suggestion (it may stay empty); back on Day 1, the suggestion again.
    fireEvent.change(dayField, { target: { value: dayIds[1] } });
    expect((time as HTMLInputElement).value).toBe("");
    fireEvent.change(dayField, { target: { value: dayIds[0] } });
    expect((time as HTMLInputElement).value).toBe("09:30");

    // Not a time: said, nothing moved.
    fireEvent.change(time, { target: { value: "9h" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add to Day 1" }));
    expect(within(form).getByText("Enter a time like 09:30, or leave it empty.")).toBeTruthy();
    expect(fake.view.ideas.map((p) => p.name)).toEqual(["Pierre Loti", "Balat"]);

    fireEvent.change(time, { target: { value: "10:15" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add to Day 1" }));
    expect(fake.view.days[0].places.map((p) => [p.name, p.time])).toEqual([
      ["Breakfast", "08:30"],
      ["Pierre Loti", "10:15"],
    ]);
    expect(fake.view.days[0].places[1].id).toBe(loti);
    expect(fake.view.ideas.map((p) => p.name)).toEqual(["Balat"]);
    // The view stays on Ideas & votes; nothing opens; it is said.
    expect(window.location.search).toBe("?view=ideas");
    expect(screen.queryByRole("region", { name: /^Details for / })).toBeNull();
    expect(names(ideasRegion())).toEqual(["Balat"]);
    expect(screen.getByTestId("plan-status").textContent).toBe("Pierre Loti added to Day 1 at 10:15");
  });

  it("adding to a day without a time leaves it untimed, as one undo step; Escape cancels", async () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Pierre Loti", category: "cafe", dayId: null }, "u1");
    const undo = createUndo(doc, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    fireEvent.click(screen.getByRole("button", { name: "Add Pierre Loti to a day" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time" }), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Add Pierre Loti to a day" })).toBeNull();
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Add Pierre Loti to a day"));

    fireEvent.click(screen.getByRole("button", { name: "Add Pierre Loti to a day" }));
    const form = screen.getByRole("form", { name: "Add Pierre Loti to a day" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Day" }), { target: { value: dayIds[1] } });
    fireEvent.click(within(form).getByRole("button", { name: "Add to Day 2" }));
    expect(fake.view.days[1].places.map((p) => [p.name, p.time])).toEqual([["Pierre Loti", null]]);
    expect(screen.getByTestId("plan-status").textContent).toBe("Pierre Loti added to Day 2");
    // The row went: focus is on the Ideas heading, not lost.
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Ideas"));
    undo.undo();
    expect(fake.view.ideas.map((p) => p.name)).toEqual(["Pierre Loti"]);
    undo.destroy();
  });

  it("read-only: no Add to day…", () => {
    const { doc } = newTrip();
    addPlace(doc, { name: "Pierre Loti", category: "cafe", dayId: null, stayMinutes: 45 }, "u1");
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    expect(names(ideasRegion())).toEqual(["Pierre Loti"]);
    expect(within(ideasRegion()).getByText("45 min")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Pierre Loti to a day" })).toBeNull();
  });
});

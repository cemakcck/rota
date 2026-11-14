import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { addPlace, setPlaceStatus, vote } from "@rota/trip";
import { renderIntl } from "./helpers";
import { fake, newTrip, remoteEdit } from "./tripHarness";
import { useFakeTrip } from "./tripHarness";

vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/authClient", () => ({
  useUserId: () => fake.userId,
  useUserState: () => ({ userId: fake.userId, signedOut: false }),
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { TripScreen } from "@/components/trip/TripScreen";

// Ideas & votes in the list column.
beforeEach(() => window.history.replaceState(null, "", "/en/t/t1?view=ideas"));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const suggest = (doc: ReturnType<typeof newTrip>["doc"], name: string, at: number) => {
  vi.setSystemTime(at);
  return addPlace(doc, { name, category: "sight", dayId: null, status: "suggested" }, "u2");
};
const section = () => screen.getByRole("region", { name: "Suggestions" });
const names = () => within(section()).queryAllByTestId("suggestion-name").map((e) => e.textContent);

describe("suggestions", () => {
  it("suggestions sort by score then newest", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { doc } = newTrip();
    suggest(doc, "Oldest", 1000);
    const b = suggest(doc, "Middle", 2000);
    suggest(doc, "Newest", 3000);
    const d = suggest(doc, "Liked", 500);
    vote(doc, d, "u2", 1);
    vote(doc, b, "u2", -1);
    renderIntl(<TripScreen tripId="t1" />);
    expect(names()).toEqual(["Liked", "Newest", "Oldest", "Middle"]);
  });

  it("a vote toggles and clears", () => {
    const { doc } = newTrip();
    const id = addPlace(doc, { name: "Moda Sahil", category: "nature", dayId: null, status: "suggested" }, "u2");
    renderIntl(<TripScreen tripId="t1" />);
    const up = screen.getByRole("button", { name: "Upvote Moda Sahil" });
    const down = screen.getByRole("button", { name: "Downvote Moda Sahil" });
    expect([up, down].map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false"]);

    fireEvent.click(up);
    expect(fake.view.suggestions[0].votes).toEqual({ u1: 1 });
    expect(up.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(down);
    expect(fake.view.suggestions[0].votes).toEqual({ u1: -1 });
    expect([up, down].map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    fireEvent.click(down);
    expect(fake.view.suggestions[0].votes).toEqual({});
    expect(down.getAttribute("aria-pressed")).toBe("false");
    expect(fake.view.suggestions[0].id).toBe(id);
  });

  it("accept moves the suggestion into the chosen day", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Moda Sahil", category: "nature", dayId: null, status: "suggested" }, "u2");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept Moda Sahil" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Day 2/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    expect(fake.view.suggestions).toEqual([]);
    expect(fake.view.days[1].places.map((p) => p.name)).toEqual(["Moda Sahil"]);
    expect(fake.view.days[1].id).toBe(dayIds[1]);
    expect(fake.view.days[1].places[0].status).toBe("planned");
  });

  it("accepting into a day asks its time (the suggestion, editable) and stay first, as one undo step", () => {
    const { doc, dayIds } = newTrip();
    addPlace(doc, { name: "Breakfast", category: "food", stayMinutes: 45, dayId: dayIds[0], time: "08:00" }, "u1");
    addPlace(doc, { name: "Moda Sahil", category: "nature", dayId: null, status: "suggested" }, "u2");
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept Moda Sahil" }));
    const dialog = screen.getByRole("dialog");
    const time = () => within(dialog).queryByLabelText("Time") as HTMLInputElement | null;
    // Day 1 is chosen: after Breakfast (08:00 + 45 min).
    expect(time()!.value).toBe("08:45");
    expect(within(within(dialog).getByRole("group", { name: "Stay" })).getByRole("button", { name: "1 h 30 min" }).getAttribute("aria-pressed")).toBe("true");
    // Day 2 has nothing timed: empty. Ideas: no time at all.
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Day 2/ }));
    expect(time()!.value).toBe("");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Ideas" }));
    expect(time()).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Day 1/ }));
    expect(time()!.value).toBe("08:45");
    // Not a time: said, nothing accepted.
    fireEvent.change(time()!, { target: { value: "9am" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a time like 09:30, or leave it empty.");
    expect(fake.view.suggestions.map((p) => p.name)).toEqual(["Moda Sahil"]);
    fireEvent.change(time()!, { target: { value: "07:30" } });
    fireEvent.click(within(within(dialog).getByRole("group", { name: "Stay" })).getByRole("button", { name: "1 h" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    expect(fake.view.suggestions).toEqual([]);
    // At its time: before Breakfast.
    expect(fake.view.days[0].places.map((p) => [p.name, p.time, p.stayMinutes, p.status])).toEqual([
      ["Moda Sahil", "07:30", 60, "planned"],
      ["Breakfast", "08:00", 45, "planned"],
    ]);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(fake.view.suggestions.map((p) => p.name)).toEqual(["Moda Sahil"]);
    expect(fake.view.days[0].places.map((p) => p.name)).toEqual(["Breakfast"]);
  });

  it("dismiss and restore keep votes", () => {
    const { doc } = newTrip();
    const id = addPlace(doc, { name: "Moda Sahil", category: "nature", dayId: null, status: "suggested" }, "u2");
    vote(doc, id, "u2", 1);
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Moda Sahil" }));
    expect(names()).toEqual([]);
    const toggle = screen.getByRole("button", { name: /Dismissed/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(fake.view.dismissed[0].votes).toEqual({ u2: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Restore Moda Sahil" }));
    expect(fake.view.dismissed).toEqual([]);
    expect(fake.view.suggestions[0]).toMatchObject({ name: "Moda Sahil", votes: { u2: 1 } });
    expect(names()).toEqual(["Moda Sahil"]);
  });

  it("Suggest adds a suggestion instead of a planned place", () => {
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);
    const search = screen.getByRole("combobox", { name: /^Add a place to/ });
    fireEvent.change(search, { target: { value: "Pierre Loti Hill" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(within(screen.getByRole("form", { name: "Add Pierre Loti Hill" })).getByRole("button", { name: "Suggest" }));
    expect(fake.view.suggestions.map((p) => p.name)).toEqual(["Pierre Loti Hill"]);
    expect(fake.view.ideas).toEqual([]);
  });

  it("is read-only without a user: scores only, no buttons", () => {
    const { doc } = newTrip();
    const id = addPlace(doc, { name: "Moda Sahil", category: "nature", dayId: null, status: "suggested" }, "u2");
    vote(doc, id, "u2", 1);
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    expect(within(section()).queryAllByRole("button")).toEqual([]);
    expect(within(section()).getByText("Score 1")).toBeTruthy();
  });

  it("announces others accepting, not votes", () => {
    const { doc } = newTrip();
    const id = addPlace(doc, { name: "Moda Sahil", category: "nature", dayId: null, status: "suggested" }, "u2");
    renderIntl(<TripScreen tripId="t1" />);
    const live = screen.getByTestId("announcer");
    remoteEdit("u2", (d, o) => vote(d, id, o, 1));
    expect(live.textContent).toBe("");
    remoteEdit("u2", (d, o) => setPlaceStatus(d, id, "planned", o));
    expect(live.textContent).toBe("Deniz moved Moda Sahil to Ideas");
  });
});

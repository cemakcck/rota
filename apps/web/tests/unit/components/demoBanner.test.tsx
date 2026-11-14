import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { setTripMeta } from "@rota/trip";
import { friendSession, isFriendWindow } from "@/client/authClient";
import { FRIEND_HANDOFF_SCRIPT } from "@/client/friendHandoff";
import { renderIntl, stubFetch } from "./helpers";
import { fake, newTrip, refresh, useFakeTrip } from "./tripHarness";

vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/authClient", async (original) => ({ ...(await original<object>()), useUserId: () => fake.userId }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { TripScreen } from "@/components/trip/TripScreen";

const deniz = { id: "u2", name: "Deniz", colour: "#ea580c" };
const handoff = (session: object) => `#rota-friend=${encodeURIComponent(JSON.stringify(session))}`;

/** A demo trip: the seeded kind, owned by the visitor (u1). */
function demoTrip() {
  const { doc } = newTrip();
  setTripMeta(doc, { isDemo: true }, "seed");
}

/** Screens of the given width for `(min-width: …)` queries. */
function screenWidth(px: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? NaN);
    return { matches: px >= min, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
}

beforeEach(() => screenWidth(1024));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("demo banner", () => {
  it("shows on demo trips only, as a named region", () => {
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.queryByRole("region", { name: "Demo" })).toBeNull();
    cleanup();

    demoTrip();
    renderIntl(<TripScreen tripId="t1" />);
    const banner = screen.getByRole("region", { name: "Demo" });
    expect(banner.textContent).toContain("This is a demo. Demo accounts and trips are deleted after 7 days without activity.");
  });

  it("Simulate offline toggles the provider", () => {
    demoTrip();
    renderIntl(<TripScreen tripId="t1" />);
    const toggle = screen.getByRole("switch", { name: "Simulate offline" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(fake.simulated).toEqual([true]);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(fake.simulated).toEqual([true, false]);
  });

  it("offline, the map says it may be incomplete", () => {
    demoTrip();
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.queryByText("Map may be incomplete offline")).toBeNull();
    fake.status = { kind: "offline", pending: 0 };
    refresh();
    expect(screen.getByText("Map may be incomplete offline")).toBeTruthy();
  });

  it("Try it with a friend fetches a friend token and opens the friend URL with the handoff", async () => {
    demoTrip();
    vi.stubGlobal("screen", { availWidth: 1600, availHeight: 900 });
    const { fn, calls } = stubFetch({ "POST /api/demo/friend-token": () => ({ body: { token: "tok-deniz", user: deniz } }) });
    vi.stubGlobal("fetch", fn);
    const child = { location: { href: "about:blank" }, opener: window as unknown, close: vi.fn() };
    const open = vi.fn(() => child);
    vi.stubGlobal("open", open);

    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Try it with a friend" }));

    // Opened at once (still in the click, so it is not blocked), at half the screen width.
    expect(open).toHaveBeenCalledTimes(1);
    const [, , features] = open.mock.calls[0] as unknown as [string, string, string];
    expect(features).toContain("width=800");
    await waitFor(() => expect(child.location.href).not.toBe("about:blank"));
    expect(calls).toEqual([{ key: "POST /api/demo/friend-token", body: { tripId: "t1" } }]);
    expect(child.location.href).toBe(`${window.location.origin}/en/t/t1?friend=1${handoff({ token: "tok-deniz", user: deniz })}`);
    expect(child.opener).toBeNull();
    expect(child.close).not.toHaveBeenCalled();
  });

  it("a failed friend token closes the window and says so", async () => {
    demoTrip();
    vi.stubGlobal("fetch", stubFetch({ "POST /api/demo/friend-token": () => ({ status: 404, body: { error: "not_found" } }) }).fn);
    const child = { location: { href: "about:blank" }, opener: window as unknown, close: vi.fn() };
    vi.stubGlobal("open", vi.fn(() => child));
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Try it with a friend" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The friend window could not open. Please try again.");
    expect(child.close).toHaveBeenCalled();
  });

  it("on wide screens, Side by side shows the friend's window in the page", async () => {
    demoTrip();
    vi.stubGlobal("fetch", stubFetch({ "POST /api/demo/friend-token": () => ({ body: { token: "tok-deniz", user: deniz } }) }).fn);
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.queryByRole("button", { name: "Side by side" })).toBeNull();
    cleanup();

    screenWidth(1280);
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    const frame = await screen.findByTitle("The same trip, signed in as Deniz");
    expect(frame.getAttribute("src")).toBe(`/en/t/t1?friend=1${handoff({ token: "tok-deniz", user: deniz })}`);
    fireEvent.click(screen.getByRole("button", { name: "Close side by side" }));
    expect(screen.queryByTitle("The same trip, signed in as Deniz")).toBeNull();
  });

  it("the friend window stores the handoff in sessionStorage and clears the hash", () => {
    const session = { token: "tok-deniz", user: deniz };
    window.history.replaceState(null, "", `/en/t/t1?friend=1${handoff(session)}`);
    new Function(FRIEND_HANDOFF_SCRIPT)();
    expect(JSON.parse(sessionStorage.getItem("rota.friend")!)).toEqual(session);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/en/t/t1?friend=1");
    expect(friendSession()).toEqual(session);
  });

  it("a page without a handoff is left alone", () => {
    window.history.replaceState(null, "", "/en/t/t1#place-1");
    new Function(FRIEND_HANDOFF_SCRIPT)();
    expect(sessionStorage.length).toBe(0);
    expect(window.location.hash).toBe("#place-1");
  });

  it("friend windows hide the banner and say who you are", () => {
    demoTrip();
    act(() => window.history.replaceState(null, "", "/en/t/t1?friend=1"));
    sessionStorage.setItem("rota.friend", JSON.stringify({ token: "tok-deniz", user: deniz }));
    expect(isFriendWindow()).toBe(true);
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.queryByRole("region", { name: "Demo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try it with a friend" })).toBeNull();
    expect(screen.getByText("You're Deniz in this window")).toBeTruthy();
  });

  it("speaks Turkish too", () => {
    demoTrip();
    renderIntl(<TripScreen tripId="t1" />, "tr");
    expect(screen.getByRole("region", { name: "Demo" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Çevrimdışı simülasyonu" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bir arkadaşla dene" })).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { setDay } from "@rota/trip";
import { renderIntl, stubFetch } from "./helpers";
import { TIPS_SEEN_U1 as SEEN_KEY, fake, newTrip, useFakeTrip } from "./tripHarness";

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

/**
 * The tips API: unseen (or `seen`) on the server until a PUT; the stub's calls say what the screen asked.
 * `late` holds the GET's answer back until it resolves.
 */
function tipsServer(seen = false, late?: Promise<void>) {
  const stub = stubFetch({
    "GET /api/profile/tips": () => ({ body: { seen } }),
    "PUT /api/profile/tips": () => {
      seen = true;
      return { status: 204 };
    },
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (late && (init?.method ?? "GET") === "GET") await late;
    return stub.fn(input, init);
  });
  return { calls: () => stub.calls.filter((c) => c.key.endsWith("/api/profile/tips")).map((c) => c.key) };
}

/** A promise and its resolve, for holding an answer back. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** `(prefers-reduced-motion: reduce)` answers `reduce`; every other query is false. */
function motion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion: reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const tour = () => screen.queryByRole("dialog");
const settle = () => act(async () => await new Promise((r) => setTimeout(r, 20)));

let scrolled: ScrollIntoViewOptions[] = [];
beforeEach(() => {
  at("");
  localStorage.clear();
  sessionStorage.clear();
  scrolled = [];
  Element.prototype.scrollIntoView = function (opts?: boolean | ScrollIntoViewOptions) {
    if (typeof opts === "object") scrolled.push(opts);
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  at("");
});

describe("first-time tour", () => {
  it("shows once, step by step, and returns focus where it was", async () => {
    newTrip({ tour: true });
    const server = tipsServer();
    renderIntl(<TripScreen tripId="t1" />);
    // Focus on a button (not in an edit): the tour still opens, and gives focus back after.
    const day1 = screen.getByRole("button", { name: /^Day 1 · / });
    day1.focus();

    const dialog = await screen.findByRole("dialog", { name: "These are your days" });
    expect(dialog.textContent).toContain("Step 1 of 3");
    // Focus is in the tour, on its main button.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Add a place — pick a time before it goes in" }).textContent).toContain("Step 2 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "These are your days" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Invite friends to plan together" }).textContent).toContain("Step 3 of 3");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(tour()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(day1));
    await waitFor(() => expect(localStorage.getItem(SEEN_KEY)).toBe("seen"));
    expect(server.calls()).toEqual(["GET /api/profile/tips", "PUT /api/profile/tips"]);
  });

  it("is remembered across a reload (the server is only checked in the background)", async () => {
    newTrip({ tour: true });
    const server = tipsServer();
    renderIntl(<TripScreen tripId="t1" />);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(localStorage.getItem(SEEN_KEY)).toBe("seen"));
    cleanup();

    renderIntl(<TripScreen tripId="t1" />);
    await settle();
    expect(tour()).toBeNull();
    expect(server.calls()).toEqual(["GET /api/profile/tips", "PUT /api/profile/tips", "GET /api/profile/tips"]);
    expect(localStorage.getItem(SEEN_KEY)).toBe("seen");
  });

  it("after Show tips again on another device, comes back on the next open here", async () => {
    newTrip();
    // Seen on this device, but reset on the server since.
    tipsServer(false);
    renderIntl(<TripScreen tripId="t1" />);
    await waitFor(() => expect(localStorage.getItem(SEEN_KEY)).toBeNull());
    // Not this visit: it was decided at open.
    await settle();
    expect(tour()).toBeNull();
    cleanup();

    renderIntl(<TripScreen tripId="t1" />);
    expect(await screen.findByRole("dialog", { name: "These are your days" })).toBeTruthy();
  });

  it("an answer arriving after the person started doing something waits for the next open", async () => {
    newTrip({ tour: true });
    const late = deferred();
    tipsServer(false, late.promise);
    renderIntl(<TripScreen tripId="t1" />);
    const search = screen.getByRole("combobox", { name: /^Add a place to/ });
    search.focus();
    fireEvent.keyDown(search, { key: "G" });
    await act(async () => late.resolve());
    await settle();
    expect(tour()).toBeNull();
    expect(document.activeElement).toBe(search);
    // Nothing is remembered: next time it shows.
    expect(localStorage.getItem(SEEN_KEY)).toBeNull();
    cleanup();

    tipsServer(false);
    renderIntl(<TripScreen tripId="t1" />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("never opens over another dialog", async () => {
    newTrip({ tour: true });
    const late = deferred();
    tipsServer(false, late.promise);
    renderIntl(<TripScreen tripId="t1" />);
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    document.body.append(other);
    await act(async () => late.resolve());
    await settle();
    other.remove();
    expect(tour()).toBeNull();
  });

  it("is not shown when the server says it was seen on another device", async () => {
    newTrip({ tour: true });
    tipsServer(true);
    renderIntl(<TripScreen tripId="t1" />);
    await waitFor(() => expect(localStorage.getItem(SEEN_KEY)).toBe("seen"));
    expect(tour()).toBeNull();
  });

  it("is skipped with Skip tour or Escape, from any step", async () => {
    newTrip({ tour: true });
    const server = tipsServer();
    renderIntl(<TripScreen tripId="t1" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(tour()).toBeNull();
    await waitFor(() => expect(server.calls()).toContain("PUT /api/profile/tips"));
    cleanup();

    localStorage.clear();
    tipsServer();
    renderIntl(<TripScreen tripId="t1" />);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(tour()).toBeNull();
  });

  it("keeps keyboard focus inside while open", async () => {
    newTrip({ tour: true });
    tipsServer();
    renderIntl(<TripScreen tripId="t1" />);
    const dialog = await screen.findByRole("dialog");
    // The rest of the screen is hidden from assistive tech while the tour is open (a modal dialog).
    expect(document.getElementById("main")!.closest("[aria-hidden=true]")).not.toBeNull();
    for (const name of ["Skip tour", "Next"]) expect(dialog.contains(screen.getByRole("button", { name }))).toBe(true);
    // Tab past the last button comes back to the first.
    screen.getByRole("button", { name: "Next" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Skip tour" }));
  });

  it("is not shown without edit access", async () => {
    newTrip({ tour: true });
    fake.userId = null;
    const server = tipsServer();
    renderIntl(<TripScreen tripId="t1" />);
    await settle();
    expect(tour()).toBeNull();
    expect(server.calls()).toEqual([]);
  });

  it("in a friend window, waits for their first edit, then shows on the next open", async () => {
    const { doc, dayIds } = newTrip({ tour: true });
    at("?friend=1");
    const server = tipsServer();
    renderIntl(<TripScreen tripId="t1" />);
    await settle();
    expect(tour()).toBeNull();
    expect(server.calls()).toEqual([]);

    // A friend's edit arriving is not theirs.
    act(() => setDay(doc, dayIds[0], { title: "Old town" }, "u2"));
    await settle();
    expect(tour()).toBeNull();

    // Their own edit: not now (it would interrupt them), but next time.
    act(() => setDay(doc, dayIds[0], { title: "Old town walk" }, "u1"));
    await settle();
    expect(tour()).toBeNull();
    cleanup();

    renderIntl(<TripScreen tripId="t1" />);
    expect(await screen.findByRole("dialog", { name: "These are your days" })).toBeTruthy();
  });

  it("does not block or crash a trip opened offline", async () => {
    newTrip({ tour: true });
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    fake.status = { kind: "offline", pending: 0 };
    renderIntl(<TripScreen tripId="t1" />);
    await settle();
    expect(tour()).toBeNull();
    expect(screen.getByRole("combobox", { name: /^Add a place to/ })).toBeTruthy();
  });

  it("finishes saving a tour seen offline the next time a trip opens", async () => {
    newTrip({ tour: true });
    localStorage.setItem(SEEN_KEY, "pending");
    const server = tipsServer();
    renderIntl(<TripScreen tripId="t1" />);
    await waitFor(() => expect(localStorage.getItem(SEEN_KEY)).toBe("seen"));
    expect(server.calls()).toEqual(["PUT /api/profile/tips"]);
    expect(tour()).toBeNull();
  });

  it("brings each target into view, without smooth scrolling when motion is reduced", async () => {
    newTrip({ tour: true });
    tipsServer();
    motion(true);
    renderIntl(<TripScreen tripId="t1" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(scrolled.length).toBeGreaterThanOrEqual(2);
    expect(scrolled.every((o) => o.behavior === "auto")).toBe(true);
    cleanup();

    localStorage.clear();
    scrolled = [];
    motion(false);
    renderIntl(<TripScreen tripId="t1" />);
    await screen.findByRole("dialog");
    expect(scrolled.at(-1)?.behavior).toBe("smooth");
  });
});

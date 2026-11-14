import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { addPlace, updatePlace } from "@rota/trip";
import { renderIntl } from "./helpers";
import { fake, newTrip, refresh, useFakeTrip } from "./tripHarness";

const push = vi.fn();
const forgetTrip = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/myTrips", () => ({ forgetTrip }));
vi.mock("@/client/authClient", () => ({
  useUserId: () => fake.userId,
  useUserState: () => ({ userId: fake.userId, signedOut: false }),
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { SyncIndicator } from "@/components/trip/SyncIndicator";
import { TripScreen } from "@/components/trip/TripScreen";

afterEach(() => {
  cleanup();
  push.mockReset();
  forgetTrip.mockClear();
});

describe("header", () => {
  it("sync indicator texts in en and tr", () => {
    const cases = [
      [{ kind: "synced", pending: 0 }, "Synced", "Eşitlendi"],
      [{ kind: "syncing", pending: 2 }, "Syncing…", "Eşitleniyor…"],
      [{ kind: "offline", pending: 0 }, "Offline — no changes waiting", "Çevrimdışı — bekleyen değişiklik yok"],
      [{ kind: "offline", pending: 1 }, "Offline — 1 change waiting", "Çevrimdışı — 1 değişiklik bekliyor"],
      [{ kind: "offline", pending: 3 }, "Offline — 3 changes waiting", "Çevrimdışı — 3 değişiklik bekliyor"],
    ] as const;
    for (const [status, en, tr] of cases) {
      const a = renderIntl(<SyncIndicator status={status} />, "en");
      expect(a.container.textContent).toBe(en);
      a.unmount();
      const b = renderIntl(<SyncIndicator status={status} />, "tr");
      expect(b.container.textContent).toBe(tr);
      b.unmount();
    }
  });

  it("shows the trip name, dates and renames the trip inline", () => {
    newTrip({ days: 3 });
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByRole("heading", { level: 1, name: "Istanbul long weekend" })).toBeTruthy();
    expect(screen.getByText("Fri, Nov 27 – Sun, Nov 29 · 3 days · 0 places")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rename trip" }));
    const input = screen.getByLabelText("Trip name");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Enter a trip name of 1 to 60 characters.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "Istanbul, long weekend" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fake.view.name).toBe("Istanbul, long weekend");
    expect(screen.getByRole("heading", { level: 1, name: "Istanbul, long weekend" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rename trip" }));
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "Something else" } });
    fireEvent.keyDown(screen.getByLabelText("Trip name"), { key: "Escape" });
    expect(fake.view.name).toBe("Istanbul, long weekend");
  });

  it("Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes my edits, but not while typing in a field", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toHaveProperty("disabled", true);
    updatePlace(doc, id, { name: "Galata Kulesi" }, "u1");
    refresh();
    expect(undo).toHaveProperty("disabled", false);

    fireEvent.keyDown(screen.getByLabelText("Place name"), { key: "z", ctrlKey: true });
    expect(fake.view.days[0].places[0].name).toBe("Galata Kulesi");

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(fake.view.days[0].places[0].name).toBe("Galata Tower");
    fireEvent.keyDown(document.body, { key: "Z", metaKey: true, shiftKey: true });
    expect(fake.view.days[0].places[0].name).toBe("Galata Kulesi");
    fireEvent.click(undo);
    expect(fake.view.days[0].places[0].name).toBe("Galata Tower");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(fake.view.days[0].places[0].name).toBe("Galata Kulesi");
  });

  it("the undo shortcut is the note's own inside an open note, toolbar included", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    updatePlace(doc, id, { name: "Galata Kulesi" }, "u1");
    refresh();

    fireEvent.click(screen.getByRole("button", { name: "Add a note to Galata Kulesi" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Bold" }), { key: "z", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Note for Galata Kulesi" }), { key: "z", ctrlKey: true });
    expect(fake.view.days[0].places[0].name).toBe("Galata Kulesi");
  });

  it("the undo shortcut does nothing while the settings sheet or a place editor is open", async () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    const trip = { id: "t1", name: "Istanbul long weekend", startDate: "2026-11-27", days: 2, members: [{ id: "u1", name: "Ann", colour: "#2563eb", role: "owner" }] };
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.endsWith("/invites") ? [] : trip)));
    renderIntl(<TripScreen tripId="t1" />);
    updatePlace(doc, id, { name: "Galata Kulesi" }, "u1");
    refresh();

    fireEvent.click(screen.getByRole("button", { name: "Trip settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Trip settings" });
    await waitFor(() => expect(dialog.querySelector("#settings-name")).toBeTruthy());
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(fake.view.days[0].places[0].name).toBe("Galata Kulesi");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    vi.unstubAllGlobals();

    fireEvent.click(screen.getByRole("button", { name: "Edit Galata Kulesi" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Save" }), { key: "z", ctrlKey: true });
    expect(fake.view.days[0].places[0].name).toBe("Galata Kulesi");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(fake.view.days[0].places[0].name).toBe("Galata Tower");
  });

  it("the header shows the sync status from the session", () => {
    newTrip();
    fake.status = { kind: "offline", pending: 4 };
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByText("Offline — 4 changes waiting")).toBeTruthy();
  });

  it("the settings menu opens the trip settings in a dialog", async () => {
    newTrip();
    const trip = { id: "t1", name: "Istanbul long weekend", startDate: "2026-11-27", days: 2, members: [{ id: "u1", name: "Ann", colour: "#2563eb", role: "owner" }] };
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.endsWith("/invites") ? [] : trip)));
    renderIntl(<TripScreen tripId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Trip settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Trip settings" });
    await waitFor(() => expect(dialog.querySelector("#settings-name")).toBeTruthy());
    vi.unstubAllGlobals();
  });

  it("a removed member sees why and can remove the trip from the device", async () => {
    newTrip();
    fake.closed = "removed";
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByRole("alert").textContent).toContain("You were removed from this trip");
    fireEvent.click(screen.getByRole("button", { name: "Remove from this device" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trips"));
    expect(forgetTrip).toHaveBeenCalledWith("t1", "u1");
  });

  it("first open while offline asks to connect once", () => {
    newTrip();
    fake.ready = false;
    fake.firstOpenOffline = true;
    renderIntl(<TripScreen tripId="t1" />);
    expect(screen.getByText("Connect once to download this trip")).toBeTruthy();
  });
});

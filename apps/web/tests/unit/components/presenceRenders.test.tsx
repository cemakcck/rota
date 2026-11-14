import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { addPlace } from "@rota/trip";
import { renderIntl } from "./helpers";
import { fake, newTrip, presencePeer, useFakeTrip } from "./tripHarness";

const rowRenders = vi.hoisted(() => ({ count: 0 }));
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
// Every place row asks who is editing it on each render: counting those calls counts row renders.
vi.mock("@/components/trip/Presence", async (original) => {
  const actual = await original<typeof import("@/components/trip/Presence")>();
  return {
    ...actual,
    useEditingPeer: (id: string) => {
      rowRenders.count++;
      return actual.useEditingPeer(id);
    },
  };
});

import { TripScreen } from "@/components/trip/TripScreen";

afterEach(cleanup);

const deniz = { id: "u2", name: "Deniz", colour: "#ea580c" };

describe("presence renders", () => {
  it("carets and map cursors do not re-render the rows", () => {
    const { doc, dayIds } = newTrip();
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    const peer = presencePeer();
    peer.set({ user: deniz, editing: null, cursor: null });
    rowRenders.count = 0;

    // This person's caret moving in a note (every keystroke), a friend's caret and map cursor.
    act(() => fake.awareness.setLocalStateField("caret", { anchor: 1, head: 1 }));
    act(() => fake.awareness.setLocalStateField("caret", { anchor: 2, head: 2 }));
    peer.set({ user: deniz, editing: null, cursor: { lat: 41, lng: 29 }, caret: { anchor: 3, head: 3 } });
    peer.set({ user: deniz, editing: null, cursor: { lat: 41.01, lng: 29 }, caret: { anchor: 4, head: 4 } });
    expect(rowRenders.count).toBe(0);

    // What a friend is editing does reach the rows.
    peer.set({ user: deniz, editing: tower, cursor: null });
    expect(rowRenders.count).toBeGreaterThan(0);
    expect(screen.getByText("Deniz is editing")).toBeTruthy();
  });
});

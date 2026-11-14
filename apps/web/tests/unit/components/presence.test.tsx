import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { addPlace, upsertMember } from "@rota/trip";
import { renderIntl } from "./helpers";
import { fake, newTrip, presencePeer, useFakeTrip } from "./tripHarness";

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

afterEach(cleanup);

const row = (name: string) => screen.getByText(name, { selector: "[data-testid=place-name]" }).closest("li")!;
const deniz = { id: "u2", name: "Deniz", colour: "#ea580c" };

describe("presence", () => {
  it("publishes who this connection is and what it is editing", () => {
    const { doc, dayIds } = newTrip();
    const id = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    expect(fake.awareness.getLocalState()).toMatchObject({ user: { id: "u1", name: "Ann", colour: "#2563eb" }, editing: null, cursor: null });

    fireEvent.click(screen.getByRole("button", { name: "Edit Galata Tower" }));
    expect(fake.awareness.getLocalState()?.editing).toBe(id);
    fireEvent.click(screen.getByRole("button", { name: "Edit Galata Tower" }));
    expect(fake.awareness.getLocalState()?.editing).toBeNull();
  });

  it("a peer editing a place outlines that row", () => {
    const { doc, dayIds } = newTrip();
    const tower = addPlace(doc, { name: "Galata Tower", category: "sight", dayId: dayIds[0] }, "u1");
    addPlace(doc, { name: "Karaköy Lokantası", category: "food", dayId: dayIds[0] }, "u1");
    renderIntl(<TripScreen tripId="t1" />);

    const peer = presencePeer();
    peer.set({ user: deniz, editing: tower, cursor: null });
    const outlined = row("Galata Tower");
    expect(outlined.style.outline).toMatch(/^2px solid (#ea580c|rgb\(234, 88, 12\))$/);
    expect(within(outlined).getByText("Deniz is editing")).toBeTruthy();
    expect(row("Karaköy Lokantası").style.outline).toBe("");
    expect(within(row("Karaköy Lokantası")).queryByText("Deniz is editing")).toBeNull();

    peer.set({ user: deniz, editing: null, cursor: null });
    expect(row("Galata Tower").style.outline).toBe("");
    expect(screen.queryByText("Deniz is editing")).toBeNull();

    // Leaving clears it too.
    peer.set({ user: deniz, editing: tower, cursor: null });
    expect(screen.getByText("Deniz is editing")).toBeTruthy();
    peer.leave();
    expect(screen.queryByText("Deniz is editing")).toBeNull();
  });

  it("avatars overflow after 5", () => {
    const { doc } = newTrip();
    const people = [
      { id: "u3", name: "Selin", colour: "#16a34a" },
      { id: "u4", name: "Mert", colour: "#0d9488" },
      { id: "u5", name: "Ece", colour: "#7c3aed" },
      { id: "u6", name: "Can", colour: "#db2777" },
      { id: "u7", name: "Zeynep", colour: "#dc2626" },
    ];
    people.forEach((p) => upsertMember(doc, p));
    renderIntl(<TripScreen tripId="t1" />);

    const here = () => screen.getByRole("list", { name: "In this trip now" });
    // Just this person.
    expect(within(here()).getAllByRole("img").map((a) => a.getAttribute("aria-label"))).toEqual(["Ann (you)"]);

    // Deniz on two devices counts once.
    presencePeer().set({ user: deniz, editing: null, cursor: null });
    presencePeer().set({ user: deniz, editing: null, cursor: null });
    for (const p of people.slice(0, 3)) presencePeer().set({ user: p, editing: null, cursor: null });
    expect(within(here()).getAllByRole("img").map((a) => a.getAttribute("aria-label"))).toEqual(["Ann (you)", "Deniz", "Selin", "Mert", "Ece"]);
    expect(within(here()).getAllByRole("img")[1].textContent).toBe("D");

    for (const p of people.slice(3)) presencePeer().set({ user: p, editing: null, cursor: null });
    const avatars = within(here()).getAllByRole("img");
    expect(avatars).toHaveLength(6);
    expect(avatars.slice(0, 5).map((a) => a.getAttribute("aria-label"))).toEqual(["Ann (you)", "Deniz", "Selin", "Mert", "Ece"]);
    expect(avatars[5].textContent).toBe("+2");
    expect(avatars[5].getAttribute("aria-label")).toBe("2 more: Can, Zeynep");
  });
});

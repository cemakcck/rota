import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderIntl, stubFetch } from "./helpers";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/client/authClient", () => ({
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));
const forgetTrip = vi.fn().mockResolvedValue(undefined);
vi.mock("@/client/myTrips", () => ({ forgetTrip: (...a: unknown[]) => forgetTrip(...a) }));

import { InvitePanel } from "@/components/trip/InvitePanel";
import { MembersPanel } from "@/components/trip/MembersPanel";
import { TripSettings } from "@/components/trip/TripSettings";
import { InviteAccept } from "@/components/trips/InviteAccept";

const TRIP = "t".repeat(22);
const ann = { id: "u1", name: "Ann", colour: "#2563eb", role: "owner" as const };
const deniz = { id: "u2", name: "Deniz", colour: "#ea580c", role: "member" as const };
const trip = { id: TRIP, name: "Lisbon", startDate: "2027-05-01", days: 3 };

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("invite panel", () => {
  it("creates a link with a QR code and copies it", async () => {
    const { fn, calls } = stubFetch({
      [`GET /api/trips/${TRIP}/invites`]: () => ({ body: [] }),
      [`POST /api/trips/${TRIP}/invites`]: () => ({ status: 201, body: { token: "tok123" } }),
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<InvitePanel tripId={TRIP} locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));
    const field = (await screen.findByLabelText("Join link")) as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/en/invite/tok123`);
    expect(calls.find((c) => c.key.startsWith("POST"))?.body).toEqual({ kind: "link" });
    const qr = within(screen.getByRole("img", { name: "QR code for the join link" })).getByTestId("qr");
    await waitFor(() => expect(qr.innerHTML).toContain("<svg"));

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(field.value));
    expect((await screen.findByRole("status")).textContent).toContain("Link copied.");
  });

  it("email invite validates the address and lists it as pending", async () => {
    let pending: unknown[] = [];
    const { fn, calls } = stubFetch({
      [`GET /api/trips/${TRIP}/invites`]: () => ({ body: pending }),
      [`POST /api/trips/${TRIP}/invites`]: () => {
        pending = [{ id: "i1", kind: "email", email: "friend@example.com", createdAt: "2026-11-14T00:00:00Z" }];
        return { status: 201, body: { status: "pending" } };
      },
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<InvitePanel tripId={TRIP} locale="en" />);
    const email = await screen.findByLabelText("Email address");
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(calls.some((c) => c.key.startsWith("POST"))).toBe(false);

    fireEvent.change(email, { target: { value: "friend@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText("Invite sent to friend@example.com. They join through the link in that email.")).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Pending invites" });
    expect(within(list).getByText("friend@example.com")).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Cancel invite for friend@example.com" })).toBeTruthy();
  });

  it("cancels a pending invite and disables an active link", async () => {
    let invites: unknown[] = [
      { id: "i1", kind: "email", email: "friend@example.com", createdAt: "x" },
      { id: "i2", kind: "link", email: null, createdAt: "y" },
    ];
    const { fn, calls } = stubFetch({
      [`GET /api/trips/${TRIP}/invites`]: () => ({ body: invites }),
      [`DELETE /api/trips/${TRIP}/invites/i1`]: () => {
        invites = invites.slice(1);
        return { status: 204 };
      },
      [`DELETE /api/trips/${TRIP}/invites/i2`]: () => {
        invites = [];
        return { status: 204 };
      },
    });
    vi.stubGlobal("fetch", fn);
    renderIntl(<InvitePanel tripId={TRIP} locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel invite for friend@example.com" }));
    await waitFor(() => expect(screen.queryByText("friend@example.com")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Disable link" }));
    await waitFor(() => expect(calls.some((c) => c.key.endsWith("/invites/i2"))).toBe(true));
    expect(await screen.findByText("No join link yet.")).toBeTruthy();
  });
});

describe("members and settings", () => {
  const routes = {
    [`GET /api/trips/${TRIP}/invites`]: () => ({ body: [] }),
  };

  it("a member sees Leave, an owner sees Transfer and Delete", () => {
    vi.stubGlobal("fetch", stubFetch(routes).fn);
    const member = renderIntl(<MembersPanel tripId={TRIP} members={[ann, deniz]} userId="u2" onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Leave trip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Make .* owner|Make owner/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    member.unmount();

    renderIntl(<TripSettings trip={trip} members={[ann, deniz]} userId="u1" locale="en" onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Make owner: Deniz" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Deniz" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete trip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave trip" })).toBeNull();
  });

  it("a member's settings have no invites and no delete", () => {
    vi.stubGlobal("fetch", stubFetch(routes).fn);
    renderIntl(<TripSettings trip={trip} members={[ann, deniz]} userId="u2" locale="en" onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Delete trip" })).toBeNull();
    expect(screen.queryByText("Invite people")).toBeNull();
    expect(screen.getByRole("button", { name: "Leave trip" })).toBeTruthy();
  });

  it("transfer asks first, then posts", async () => {
    const onChanged = vi.fn();
    const { fn, calls } = stubFetch({ ...routes, [`POST /api/trips/${TRIP}/members/u2/owner`]: () => ({ status: 204 }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<MembersPanel tripId={TRIP} members={[ann, deniz]} userId="u1" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Make owner: Deniz" }));
    expect(calls).toHaveLength(0);
    const dialog = await screen.findByRole("dialog", { name: "Make Deniz the owner?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Make owner" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls[0].key).toBe(`POST /api/trips/${TRIP}/members/u2/owner`);
  });

  it("leaving drops the device copy and goes to My trips", async () => {
    const { fn } = stubFetch({ [`DELETE /api/trips/${TRIP}/members/u2`]: () => ({ status: 204 }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<MembersPanel tripId={TRIP} members={[ann, deniz]} userId="u2" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Leave trip" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trips"));
    expect(forgetTrip).toHaveBeenCalledWith(TRIP, "u2");
  });

  it("delete requires typing the trip name", async () => {
    const { fn, calls } = stubFetch({ ...routes, [`DELETE /api/trips/${TRIP}`]: () => ({ status: 204 }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripSettings trip={trip} members={[ann]} userId="u1" locale="en" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete trip" }));
    const dialog = await screen.findByRole("dialog", { name: 'Delete "Lisbon"?' });
    const confirm = within(dialog).getByRole("button", { name: "Delete forever" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Trip name"), { target: { value: "Lisbo" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Trip name"), { target: { value: "Lisbon" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trips"));
    expect(calls.some((c) => c.key === `DELETE /api/trips/${TRIP}`)).toBe(true);
    expect(forgetTrip).toHaveBeenCalledWith(TRIP, "u1");
  });

  it("saving the details patches only what changed", async () => {
    const onChanged = vi.fn();
    const { fn, calls } = stubFetch({ ...routes, [`PATCH /api/trips/${TRIP}`]: () => ({ status: 204 }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<TripSettings trip={trip} members={[ann]} userId="u1" locale="en" onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "Lisbon 2027" } });
    fireEvent.change(screen.getByLabelText("Number of days"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.key.startsWith("PATCH"))?.body).toEqual({ name: "Lisbon 2027", days: 5 });
  });
});

describe("invite page", () => {
  it("an unknown link says it no longer works", async () => {
    vi.stubGlobal("fetch", stubFetch({ "POST /api/invites/dead": () => ({ status: 404, body: { error: "not_found" } }) }).fn);
    renderIntl(<InviteAccept token="dead" signedIn />);
    expect((await screen.findByRole("alert")).textContent).toContain("This invite link no longer works");
  });

  it("signed in, accepts and opens the trip", async () => {
    vi.stubGlobal("fetch", stubFetch({ "POST /api/invites/ok": () => ({ status: 200, body: { tripId: TRIP } }) }).fn);
    renderIntl(<InviteAccept token="ok" signedIn />);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/t/${TRIP}`));
  });

  it("signed out, offers sign in and sign up that come back here", () => {
    renderIntl(<InviteAccept token="ok" signedIn={false} />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in?next=%2Finvite%2Fok");
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/sign-up?next=%2Finvite%2Fok");
  });
});

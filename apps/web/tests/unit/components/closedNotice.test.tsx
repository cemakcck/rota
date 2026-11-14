import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderIntl } from "./helpers";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ClosedNotice } from "@/components/trip/ClosedNotice";

const TRIP = "t".repeat(22);
const onRemove = vi.fn().mockResolvedValue(undefined);
afterEach(cleanup);

describe("ClosedNotice", () => {
  it("signed out: the copy and its edits are kept, so it asks to sign in to sync them and offers no removal", () => {
    renderIntl(<ClosedNotice reason="unauthorized" tripId={TRIP} pending={3} onRemove={onRemove} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Sign in to sync your 3 changes.");
    expect(alert.textContent).not.toContain("not saved");
    expect(screen.queryByRole("button", { name: "Remove from this device" })).toBeNull();
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe(`/sign-in?next=${encodeURIComponent(`/t/${TRIP}`)}`);
    expect(signIn.className).toContain("bg-ink"); // the primary button style
  });

  it("signed out with one or no pending change, in both languages", () => {
    renderIntl(<ClosedNotice reason="unauthorized" tripId={TRIP} pending={1} onRemove={onRemove} />);
    expect(screen.getByRole("alert").textContent).toContain("Sign in to sync your 1 change.");
    cleanup();
    renderIntl(<ClosedNotice reason="unauthorized" tripId={TRIP} pending={0} onRemove={onRemove} />);
    expect(screen.getByRole("alert").textContent).toContain("Sign in to sync this trip again.");
    cleanup();
    renderIntl(<ClosedNotice reason="unauthorized" tripId={TRIP} pending={2} onRemove={onRemove} />, "tr");
    expect(screen.getByRole("alert").textContent).toContain("2 değişikliğinizi eşitlemek için giriş yapın.");
    expect(screen.getByRole("link", { name: "Giriş yap" })).toBeTruthy();
  });

  it("removed: edits after that are not saved, and the copy can be removed", () => {
    renderIntl(<ClosedNotice reason="removed" tripId={TRIP} pending={2} onRemove={onRemove} />);
    expect(screen.getByRole("alert").textContent).toContain("Changes made on this device after that are not saved.");
    expect(screen.getByRole("button", { name: "Remove from this device" })).toBeTruthy();
  });
});

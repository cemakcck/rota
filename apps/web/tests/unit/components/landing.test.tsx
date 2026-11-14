import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderIntl, stubFetch } from "./helpers";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { Landing } from "@/components/landing/Landing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("landing", () => {
  it("Try the demo posts the locale and navigates to the trip", async () => {
    const { fn, calls } = stubFetch({ "POST /api/demo": () => ({ status: 201, body: { tripId: "abc123" } }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<Landing locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/t/abc123"));
    expect(calls[0]).toEqual({ key: "POST /api/demo", body: { locale: "en" } });
  });

  it("429 shows the friendly message with a way to sign up", async () => {
    const { fn } = stubFetch({ "POST /api/demo": () => ({ status: 429, body: { error: "rate_limited" } }) });
    vi.stubGlobal("fetch", fn);
    renderIntl(<Landing locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You've started a lot of demos today. Sign up instead?");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getAllByRole("link", { name: "Sign up" }).length).toBeGreaterThan(0);
  });

  it("links to sign in, sign up and GitHub", () => {
    renderIntl(<Landing locale="en" />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
    expect(screen.getByRole("link", { name: "Rota on GitHub" }).getAttribute("href")).toMatch(/^https:\/\/github\.com\/cemakcck\//);
  });
});

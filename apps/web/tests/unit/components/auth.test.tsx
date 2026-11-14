import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { MEMBER_COLOURS } from "@rota/trip";
import { renderIntl } from "./helpers";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const signUp = vi.fn();
const signIn = vi.fn();
const signOut = vi.fn();
const forgetUser = vi.fn();
vi.mock("@/client/authClient", () => ({
  authClient: {
    signUp: { email: (...a: unknown[]) => signUp(...a) },
    signIn: { email: (...a: unknown[]) => signIn(...a) },
    signOut: () => signOut(),
    useSession: () => ({ data: { user: { id: "u1", name: "Ann" } }, isPending: false, error: null }),
  },
  forgetUser: () => forgetUser(),
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));

import { SignUpForm } from "@/components/auth/SignUpForm";
import { SignInForm } from "@/components/auth/SignInForm";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { safeNext } from "@/components/auth/next";

beforeEach(() => {
  signUp.mockResolvedValue({ data: {}, error: null });
  signIn.mockResolvedValue({ data: {}, error: null });
  signOut.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("sign up", () => {
  it("validates name length and password length, and prefills the email from the query", async () => {
    renderIntl(<SignUpForm email="friend@example.com" />);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("friend@example.com");

    fill("Name", "   ");
    fill("Password", "short");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter a name of 1 to 30 characters.")).toBeTruthy();
    expect(screen.getByText("Use at least 8 characters.", { selector: "p" })).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();

    fill("Name", "x".repeat(31));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter a name of 1 to 30 characters.")).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("offers the 8 member colours and signs up, then goes to My trips", async () => {
    renderIntl(<SignUpForm />);
    expect(screen.getAllByRole("radio")).toHaveLength(MEMBER_COLOURS.length);
    fill("Name", "  Ada ");
    fill("Email", "ada@example.com");
    fill("Password", "long-enough-1");
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trips"));
    expect(signUp).toHaveBeenCalledWith({ name: "Ada", email: "ada@example.com", password: "long-enough-1", colour: "#2563eb" });
  });

  it("returns to the page it came from", async () => {
    renderIntl(<SignUpForm next="/invite/tok" />);
    fireEvent.click(screen.getByRole("radio", { name: "Teal" }));
    fill("Name", "Ada");
    fill("Email", "ada@example.com");
    fill("Password", "long-enough-1");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/invite/tok"));
  });
});

describe("sign in and out", () => {
  it("shows a message for a wrong password", async () => {
    signIn.mockResolvedValue({ data: null, error: { message: "Invalid" } });
    renderIntl(<SignInForm />);
    fill("Email", "ada@example.com");
    fill("Password", "whatever-1");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That email and password do not match.");
    expect(push).not.toHaveBeenCalled();
  });

  it("sign out forgets the remembered user as well as the session", async () => {
    renderIntl(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(signOut).toHaveBeenCalled();
    expect(forgetUser).toHaveBeenCalled();
  });

  it("only follows return paths inside the app", () => {
    expect(safeNext("/invite/abc")).toBe("/invite/abc");
    expect(safeNext("/invite/abc?x=1")).toBe("/invite/abc?x=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "/\t/evil.com", "/\n/evil.com", "/\u0000x", "/ /evil.com", undefined, ""]) expect(safeNext(bad)).toBe("/trips");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const session = vi.hoisted(() => ({ value: { data: null, isPending: false, error: null } as { data: unknown; isPending: boolean; error: unknown } }));
vi.mock("better-auth/react", () => ({ createAuthClient: () => ({ useSession: () => session.value }) }));

import { useUserState } from "@/client/authClient";

const remember = () => localStorage.setItem("rota.user", JSON.stringify({ id: "u1", name: "Ann", colour: "#2563eb" }));

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("useUserState", () => {
  it("an expired session online is signed out on the render it settles, even with a remembered user", () => {
    remember();
    session.value = { data: null, isPending: false, error: null };
    const renders: boolean[] = [];
    renderHook(() => {
      const state = useUserState();
      renders.push(state.signedOut);
      return state;
    });
    expect(renders[0]).toBe(true);
  });

  it("a session fetch that failed (offline) or is still pending is not signed out", () => {
    remember();
    session.value = { data: null, isPending: false, error: new Error("network") };
    expect(renderHook(() => useUserState()).result.current).toEqual({ userId: "u1", signedOut: false });
    session.value = { data: null, isPending: true, error: null };
    expect(renderHook(() => useUserState()).result.current.signedOut).toBe(false);
  });

  it("a signed-in session is not signed out, and a friend window is never redirected", () => {
    session.value = { data: { user: { id: "u2", name: "Bo" } }, isPending: false, error: null };
    expect(renderHook(() => useUserState()).result.current).toEqual({ userId: "u2", signedOut: false });
    session.value = { data: null, isPending: false, error: null };
    window.history.replaceState(null, "", "/en/trips?friend=1");
    expect(renderHook(() => useUserState()).result.current.signedOut).toBe(false);
  });
});

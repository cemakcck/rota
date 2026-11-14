import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, authHeaders, forgetUser, friendSession, isFriendWindow, rememberedUser, resolveUserId, syncToken, trackSessionUser } from "@/client/authClient";

const deniz = { id: "u-deniz", name: "Deniz", colour: "#ea580c" };

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("auth client", () => {
  it("friend mode uses the sessionStorage bearer token, not the cookie", () => {
    sessionStorage.setItem("rota.friend", JSON.stringify({ token: "friend-token", user: deniz }));
    expect(isFriendWindow()).toBe(true);
    expect(friendSession()).toEqual({ token: "friend-token", user: deniz });
    expect(authHeaders()).toEqual({ Authorization: "Bearer friend-token" });
    expect(syncToken()).toBe("friend-token");
  });

  it("outside friend mode the cookie is used and no header is added", () => {
    expect(isFriendWindow()).toBe(false);
    expect(friendSession()).toBeNull();
    expect(authHeaders()).toEqual({});
    expect(syncToken()).toBe("cookie");
  });

  it("a friend window whose token has not arrived has no sync token, so it never syncs as the visitor", () => {
    window.history.replaceState(null, "", "/en/trips/x?friend=1");
    expect(isFriendWindow()).toBe(true);
    expect(syncToken()).toBeNull();
  });

  it("ignores a malformed friend session", () => {
    sessionStorage.setItem("rota.friend", "{not json");
    expect(friendSession()).toBeNull();
    sessionStorage.setItem("rota.friend", JSON.stringify({ token: 42 }));
    expect(friendSession()).toBeNull();
    // Still a friend window, so it waits for a usable token rather than falling back to the visitor's cookie.
    expect(syncToken()).toBeNull();
  });

  it("apiFetch sends the friend's bearer and keeps the caller's headers", async () => {
    sessionStorage.setItem("rota.friend", JSON.stringify({ token: "friend-token", user: deniz }));
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await apiFetch("/api/trips", { method: "POST", headers: { "content-type": "application/json" } });
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/trips");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer friend-token");
    expect(headers.get("content-type")).toBe("application/json");
  });
});

describe("current user id", () => {
  const ada = { id: "u-ada", name: "Ada", colour: "#2563eb" };
  const signedIn = { data: { user: ada }, isPending: false, error: null };
  const offline = { data: null, isPending: false, error: new Error("Failed to fetch") };
  const loading = { data: null, isPending: true, error: null };
  const signedOut = { data: null, isPending: false, error: null };

  it("a signed-in cookie user keeps their id offline and while the session loads", () => {
    trackSessionUser(signedIn);
    expect(rememberedUser()).toEqual(ada);
    expect(resolveUserId(signedIn)).toBe("u-ada");
    expect(resolveUserId(offline)).toBe("u-ada");
    expect(resolveUserId(loading)).toBe("u-ada");
    trackSessionUser(offline);
    expect(rememberedUser()).toEqual(ada);
  });

  it("there is no id (null, never '') once signed out or before any session was seen", () => {
    expect(resolveUserId(offline)).toBeNull();
    trackSessionUser(signedIn);
    trackSessionUser(signedOut);
    expect(rememberedUser()).toBeNull();
    expect(resolveUserId(signedOut)).toBeNull();
  });

  it("a friend window is the friend, and nobody until its token arrives", () => {
    trackSessionUser(signedIn);
    window.history.replaceState(null, "", "/en/trips/x?friend=1");
    expect(resolveUserId(signedIn)).toBeNull();
    sessionStorage.setItem("rota.friend", JSON.stringify({ token: "friend-token", user: deniz }));
    expect(resolveUserId(signedIn)).toBe("u-deniz");
  });

  it("a friend window never touches the visitor's remembered user", () => {
    trackSessionUser(signedIn);
    window.history.replaceState(null, "", "/en/t/x?friend=1");
    sessionStorage.setItem("rota.friend", JSON.stringify({ token: "friend-token", user: deniz }));
    // Its bearer session is Deniz: not remembered as the device's user.
    trackSessionUser({ data: { user: deniz }, isPending: false, error: null });
    expect(rememberedUser()).toEqual(ada);
    // Its session settling signed out, or a sign-out there, does not forget the visitor.
    trackSessionUser(signedOut);
    forgetUser();
    expect(rememberedUser()).toEqual(ada);
    // Back in the visitor's window, offline: still the visitor.
    sessionStorage.clear();
    window.history.replaceState(null, "", "/en/t/x");
    expect(resolveUserId(offline)).toBe("u-ada");
  });

  it("forgetUser drops the remembered user (signing out)", () => {
    trackSessionUser(signedIn);
    forgetUser();
    expect(rememberedUser()).toBeNull();
    expect(resolveUserId(offline)).toBeNull();
  });

  it("ignores a corrupted remembered user", () => {
    localStorage.setItem("rota.user", "{nope");
    expect(rememberedUser()).toBeNull();
    expect(resolveUserId(offline)).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, authHeaders, friendSession, isFriendWindow, syncToken } from "@/client/authClient";

const deniz = { id: "u-deniz", name: "Deniz", colour: "#ea580c" };

afterEach(() => {
  sessionStorage.clear();
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

  it("?friend=1 marks a friend window before its token has arrived", () => {
    window.history.replaceState(null, "", "/en/trips/x?friend=1");
    expect(isFriendWindow()).toBe(true);
    expect(syncToken()).toBe("cookie");
  });

  it("ignores a malformed friend session", () => {
    sessionStorage.setItem("rota.friend", "{not json");
    expect(friendSession()).toBeNull();
    sessionStorage.setItem("rota.friend", JSON.stringify({ token: 42 }));
    expect(friendSession()).toBeNull();
    expect(syncToken()).toBe("cookie");
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemote, getJson, RequestRefused } from "@/client/remote";

afterEach(() => {
  vi.useRealTimers();
});

const answer = (key: string) => Promise.resolve(new Map([[key, `value of ${key}`]]));

describe("remote", () => {
  it("a stalled request fails after 10 s, the queue moves on, and it is asked again later", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const load = vi.fn((keys: string[], signal: AbortSignal) => {
      signals.push(signal);
      // The first answer never comes (a half-open connection); later ones do.
      return load.mock.calls.length === 1 ? new Promise<Map<string, string>>(() => undefined) : answer(keys[0]);
    });
    const remote = createRemote(load);
    remote.request(["a", "b"]);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    // Timed out: its request is aborted, and the next key goes.
    expect(signals[0].aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(remote.get("b")).toBe("value of b");
    expect(remote.get("a")).toBeUndefined();
    // A timed-out key is a failure like any other: asked again once due.
    await vi.advanceTimersByTimeAsync(60_000);
    remote.request(["a", "b"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
    expect(remote.get("a")).toBe("value of a");
  });

  it("a request the server refuses (4xx other than 429) is not asked again", async () => {
    vi.useFakeTimers();
    const load = vi.fn(() => Promise.reject(new RequestRefused(400)));
    const remote = createRemote(load);
    remote.request(["bad"]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    remote.request(["bad"]);
    remote.request(["bad"], true);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("getJson refuses for good on 4xx except 429, and fails retryably otherwise", async () => {
    const status = (code: number) => () => Promise.resolve(new Response("{}", { status: code }));
    await expect(getJson("/api/x", status(400))).rejects.toBeInstanceOf(RequestRefused);
    await expect(getJson("/api/x", status(404))).rejects.toBeInstanceOf(RequestRefused);
    for (const code of [429, 503, 500]) {
      const err = await getJson("/api/x", status(code)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(RequestRefused);
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { withDbRetry } from "@/server/db/client";

const fast = { baseDelayMs: 1 };

describe("withDbRetry", () => {
  it("retries a dropped first connection", async () => {
    const fn = vi.fn().mockRejectedValueOnce({ code: "ECONNRESET" }).mockResolvedValue("ok");
    await expect(withDbRetry(fn, fast)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a constraint violation", async () => {
    const fn = vi.fn().mockRejectedValue({ code: "23505" });
    await expect(withDbRetry(fn, fast)).rejects.toMatchObject({ code: "23505" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after 4 attempts", async () => {
    const fn = vi.fn().mockRejectedValue({ code: "CONNECTION_ENDED" });
    await expect(withDbRetry(fn, fast)).rejects.toMatchObject({ code: "CONNECTION_ENDED" });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("sees a connection error wrapped as a cause", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed query", { cause: { code: "57P01" } }))
      .mockResolvedValue(1);
    await expect(withDbRetry(fn, fast)).resolves.toBe(1);
  });
});

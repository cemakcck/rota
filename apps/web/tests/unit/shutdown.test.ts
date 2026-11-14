import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { exitOnSignals } from "@/server/shutdown";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("exitOnSignals", () => {
  it.each(["SIGTERM", "SIGINT"])("%s closes the server, then exits 0; a second signal does not close twice", async (signal) => {
    const proc = new EventEmitter();
    const exit = vi.fn();
    let finish!: () => void;
    const close = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    exitOnSignals({ close }, { proc, exit, log: () => {} });

    proc.emit(signal);
    proc.emit(signal);
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled(); // still storing documents
    finish();
    await flush();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("a failing close still exits, with 1", async () => {
    const proc = new EventEmitter();
    const exit = vi.fn();
    const log = vi.fn();
    exitOnSignals({ close: () => Promise.reject(new Error("db down")) }, { proc, exit, log });
    proc.emit("SIGTERM");
    await flush();
    expect(log).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a close that hangs is cut off after the grace period", async () => {
    vi.useFakeTimers();
    try {
      const proc = new EventEmitter();
      const exit = vi.fn();
      exitOnSignals({ close: () => new Promise<void>(() => {}) }, { proc, exit, log: () => {}, graceMs: 5000 });
      proc.emit("SIGTERM");
      await vi.advanceTimersByTimeAsync(4999);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

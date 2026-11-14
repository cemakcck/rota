import { describe, expect, it } from "vitest";
import { syncStatus } from "@/client/sync/status";

describe("syncStatus", () => {
  it.each([
    // online, connected, synced, unsynced → kind, pending
    [false, false, false, 0, "offline", 0],
    [false, false, true, 3, "offline", 3],
    [true, false, false, 2, "offline", 2],
    [true, false, true, 0, "offline", 0],
    [false, true, true, 0, "offline", 0],
    [true, true, false, 0, "syncing", 0],
    [true, true, false, 1, "syncing", 1],
    [true, true, true, 4, "syncing", 4],
    [true, true, true, 0, "synced", 0],
  ] as const)("online=%s connected=%s synced=%s unsynced=%s → %s (%s waiting)", (online, connected, synced, unsynced, kind, pending) => {
    expect(syncStatus({ online, connected, synced, unsynced })).toEqual({ kind, pending });
  });
});

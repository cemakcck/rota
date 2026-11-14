import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { initTrip, newTripId, readTrip } from "@rota/trip";
import { forgetTrip } from "@/client/myTrips";
import { useTrip } from "@/client/sync/useTrip";

type ProviderConfig = { url: string; name: string; document: Y.Doc; token: string };

const { StubProvider } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const { readTrip } = await import("@rota/trip");
  /** Stands in for HocuspocusProvider: records how it was made and lets the test emit server events. */
  class StubProvider extends EventEmitter {
    static made: StubProvider[] = [];
    unsyncedChanges = 0;
    synced = false;
    awareness = null;
    connects = 0;
    disconnects = 0;
    /** The trip's name as it was in the document when the provider was attached. */
    nameAtAttach: string;
    constructor(readonly configuration: ProviderConfig) {
      super();
      this.nameAtAttach = readTrip(configuration.document).name;
      StubProvider.made.push(this);
    }
    connect() {
      this.connects++;
    }
    disconnect() {
      this.disconnects++;
    }
    destroy() {
      this.removeAllListeners();
    }
  }
  return { StubProvider };
});

vi.mock("@hocuspocus/provider", () => ({ HocuspocusProvider: StubProvider }));
vi.mock("@/client/authClient", async (original) => ({
  ...(await original<typeof import("@/client/authClient")>()),
  useUserId: () => "u-ada",
}));

async function seedLocalTrip(name: string): Promise<string> {
  const id = newTripId();
  const doc = new Y.Doc();
  initTrip(doc, { name, startDate: "2026-12-04", days: 3, locale: "en" }, "seed");
  const idb = new IndexeddbPersistence(`rota-trip-${id}`, doc);
  await idb.whenSynced;
  await idb.destroy();
  return id;
}

async function openTrip(id: string) {
  const hook = renderHook(() => useTrip(id));
  await waitFor(() => expect(StubProvider.made.at(-1)?.configuration.name).toBe(id));
  return { hook, provider: StubProvider.made.at(-1)! };
}

const databaseNames = async () => (await indexedDB.databases()).map((d) => d.name);

afterEach(() => {
  StubProvider.made = [];
  localStorage.clear();
});

describe("useTrip", () => {
  it("loads IndexedDB first, then attaches the provider to /sync with the cookie token", async () => {
    const id = await seedLocalTrip("Istanbul long weekend");
    const { hook, provider } = await openTrip(id);

    expect(provider.nameAtAttach).toBe("Istanbul long weekend");
    expect(provider.configuration).toMatchObject({ url: `ws://${location.host}/sync`, name: id, token: "cookie" });
    expect(provider.configuration.document).toBe(hook.result.current.doc);
    await waitFor(() => expect(hook.result.current.view.name).toBe("Istanbul long weekend"));
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.userId).toBe("u-ada");
    hook.unmount();
  });

  it("removed reason shows closed=removed and keeps the local doc until forgetTrip", async () => {
    const id = await seedLocalTrip("Istanbul long weekend");
    const { hook, provider } = await openTrip(id);

    act(() => {
      provider.emit("close", { event: { code: 4205, reason: "removed" } });
    });

    expect(hook.result.current.closed).toBe("removed");
    expect(provider.disconnects).toBeGreaterThan(0);
    act(() => hook.result.current.simulateOffline(false));
    expect(provider.connects).toBe(0);
    expect(readTrip(hook.result.current.doc).name).toBe("Istanbul long weekend");
    expect(await databaseNames()).toContain(`rota-trip-${id}`);

    hook.unmount();
    await forgetTrip(id);
    expect(await databaseNames()).not.toContain(`rota-trip-${id}`);
  });

  it.each([
    ["authenticationFailed", { reason: "deleted" }, "deleted"],
    ["authenticationFailed", { reason: "not-found" }, "not-found"],
    ["authenticationFailed", { reason: "unauthorized" }, "unauthorized"],
    ["close", { event: { code: 4403, reason: "deleted" } }, "deleted"],
    ["close", { event: { code: 4403, reason: "removed" } }, "removed"],
  ] as const)("%s %j closes the trip as %s", async (event, payload, closed) => {
    const id = await seedLocalTrip("Lisbon");
    const { hook, provider } = await openTrip(id);
    act(() => {
      provider.emit(event, payload);
    });
    expect(hook.result.current.closed).toBe(closed);
    hook.unmount();
  });

  it("an ordinary disconnect or a full trip does not close it", async () => {
    const id = await seedLocalTrip("Lisbon");
    const { hook, provider } = await openTrip(id);
    act(() => {
      provider.emit("close", { event: { code: 1006, reason: "" } });
      provider.emit("close", { event: { code: 4429, reason: "full" } });
    });
    expect(hook.result.current.closed).toBeNull();
    expect(provider.disconnects).toBe(0);
    hook.unmount();
  });

  it("reports pending changes and simulated offline", async () => {
    const id = await seedLocalTrip("Lisbon");
    const { hook, provider } = await openTrip(id);
    act(() => {
      provider.emit("status", { status: "connected" });
      provider.synced = true;
      provider.emit("synced", { state: true });
    });
    expect(hook.result.current.status).toEqual({ kind: "synced", pending: 0 });

    act(() => hook.result.current.simulateOffline(true));
    act(() => {
      provider.emit("status", { status: "disconnected" });
      provider.unsyncedChanges = 2;
      provider.emit("unsyncedChanges", { number: 2 });
    });
    expect(provider.disconnects).toBe(1);
    expect(hook.result.current.status).toEqual({ kind: "offline", pending: 2 });

    act(() => hook.result.current.simulateOffline(false));
    expect(provider.connects).toBe(1);
    hook.unmount();
  });

  it("a first open while offline says so instead of showing an empty trip", async () => {
    const { hook, provider } = await openTrip(newTripId());
    act(() => {
      provider.emit("status", { status: "disconnected" });
    });
    expect(hook.result.current.ready).toBe(false);
    expect(hook.result.current.firstOpenOffline).toBe(true);
    hook.unmount();
  });
});

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { expect, it, vi, type MockInstance } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import { readTrip, setTripMeta } from "@rota/trip";
import type { RunningServer } from "../../server";
import { loadState } from "@/server/trips/docStore";
import { addMember, createTrip } from "@/server/trips/repo";
import { NEW_TRIP, ORIGIN, signUpUser, type TestUser } from "./helpers";

// Checks of the whole server (custom server + Next + sync), shared by the dev and production suites.

type Provider = { doc: Y.Doc; provider: HocuspocusProvider; synced: Promise<void> };
const providers: Provider[] = [];

export function connect(url: string, tripId: string, user: TestUser): Provider {
  const socket = new HocuspocusProviderWebsocket({ url: `${url.replace("http", "ws")}/sync`, WebSocketPolyfill: WebSocket });
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: tripId, document: doc, token: user.token });
  provider.attach();
  const p = { doc, provider, synced: new Promise<void>((resolve) => provider.on("synced", () => resolve())) };
  providers.push(p);
  return p;
}

/** For afterEach: closes every provider opened by `connect`. */
export function closeProviders(): void {
  for (const p of providers.splice(0)) {
    p.provider.destroy();
    p.provider.configuration.websocketProvider.destroy();
  }
}

/**
 * Watches the console for Yjs announcing a second copy of itself. Call before the server starts:
 * the copy announces itself when Next first loads a route bundle that contains it.
 */
export function watchForSecondYjs(): { loaded(): boolean; restore(): void } {
  const spies: MockInstance[] = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
  return {
    loaded: () => spies.some((spy) => spy.mock.calls.some((args) => args.some((a) => /Yjs was already imported/.test(String(a))))),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** Registers the tests that need a running server: sync between members and route handlers editing live documents. */
export function liveServerTests(ctx: () => { server: RunningServer; yjs: { loaded(): boolean } }): void {
  it("/sync keeps working after pages have been served", async () => {
    const { server } = ctx();
    // Next attaches its own upgrade listener on the first request it handles.
    expect((await fetch(`${server.url}/en`)).status).toBe(200);
    const [ann, bob] = [await signUpUser({ name: "Ann" }), await signUpUser({ name: "Bob" })];
    const id = await createTrip({ ownerId: ann.id, ...NEW_TRIP, destination: null, isDemo: false });
    await addMember(id, bob.id, "member");
    const a = connect(server.url, id, ann);
    const b = connect(server.url, id, bob);
    await Promise.all([a.synced, b.synced]);
    setTripMeta(a.doc, { name: "Porto" }, ann.id);
    await vi.waitFor(() => expect(readTrip(b.doc).name).toBe("Porto"), { timeout: 5000, interval: 20 });
  }, 30_000);

  it("an API route edits the live document through the real server, with one Yjs", async () => {
    const { server, yjs } = ctx();
    const ann = await signUpUser({ name: "Ann" });
    const id = await createTrip({ ownerId: ann.id, ...NEW_TRIP, destination: null, isDemo: false });
    const a = connect(server.url, id, ann);
    await a.synced;
    const res = await fetch(`${server.url}/api/trips/${id}`, {
      method: "PATCH",
      headers: { origin: ORIGIN, authorization: `Bearer ${ann.token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed by the API" }),
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    await vi.waitFor(() => expect(readTrip(a.doc).name).toBe("Renamed by the API"), { timeout: 5000, interval: 20 });
    expect(yjs.loaded()).toBe(false);
  }, 60_000);

  it("POST /api/demo seeds the demo trip through the real server", async () => {
    const { server, yjs } = ctx();
    const res = await fetch(`${server.url}/api/demo`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": randomIp() },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { tripId } = (await res.json()) as { tripId: string };
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await loadState(tripId))!);
    const trip = readTrip(doc);
    expect(trip.members.length).toBeGreaterThan(1);
    expect(trip.placeCount).toBeGreaterThan(0);
    expect(yjs.loaded()).toBe(false);
  }, 60_000);
}

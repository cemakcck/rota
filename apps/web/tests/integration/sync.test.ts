import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import { addDay, addPlace, newTripId, readTrip, setTripMeta } from "@rota/trip";
import { startServer, type RunningServer } from "../../server";
import { db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { createSyncServer, serveSync } from "@/server/sync";
import { loadState, storeState } from "@/server/trips/docStore";
import { addMember, createTrip, deleteTrip, removeMember } from "@/server/trips/repo";
import { NEW_TRIP, signUpUser, type TestUser } from "./helpers";

type Client = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Resolves once the server accepted the connection and the first sync finished. */
  synced: Promise<void>;
  /** Resolves with the reason the server refused authentication. */
  refused: Promise<string>;
  /** Resolves with the first close (a closed socket or the server closing this document). */
  closed: Promise<{ code: number; reason: string }>;
};

const open: Client[] = [];

/** A Node client like the browser's: bearer token when it has one, else "cookie" plus the cookie header. */
function connect(server: { url: string }, tripId: string, auth: { token?: string; cookie?: string }): Client {
  const headers = auth.cookie ? { cookie: auth.cookie } : {};
  class NodeWebSocket extends WebSocket {
    constructor(url: string) {
      super(url, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({
    url: `${server.url.replace("http", "ws")}/sync`,
    WebSocketPolyfill: NodeWebSocket,
  });
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: tripId, document: doc, token: auth.token ?? "cookie" });
  provider.attach();
  const client: Client = {
    doc,
    provider,
    synced: new Promise((resolve) => provider.on("synced", () => resolve())),
    refused: new Promise((resolve) => provider.on("authenticationFailed", ({ reason }: { reason: string }) => resolve(reason))),
    closed: new Promise((resolve) => provider.on("close", ({ event }: { event: { code: number; reason: string } }) => resolve(event))),
  };
  open.push(client);
  return client;
}

const as = (u: TestUser) => ({ token: u.token });

function close(client: Client) {
  client.provider.destroy();
  client.provider.configuration.websocketProvider.destroy();
}

async function newTrip(owner: TestUser, ...members: TestUser[]): Promise<string> {
  const id = await createTrip({ ownerId: owner.id, ...NEW_TRIP, destination: null, isDemo: false });
  for (const m of members) await addMember(id, m.id, "member");
  return id;
}

const storedTrip = async (id: string) => {
  const state = await loadState(id);
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return { doc, view: readTrip(doc) };
};

describe("sync server", () => {
  let server: RunningServer;
  let ann: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    server = await startServer({ port: 0, dev: true });
    ann = await signUpUser({ name: "Ann" });
    bob = await signUpUser({ name: "Bob" });
  }, 120_000);

  afterEach(() => {
    for (const c of open.splice(0)) close(c);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await server?.close();
  });

  it("two members converge within 2 seconds", async () => {
    const id = await newTrip(ann, bob);
    const a = connect(server, id, as(ann));
    const b = connect(server, id, as(bob));
    await Promise.all([a.synced, b.synced]);
    setTripMeta(a.doc, { name: "Porto" }, ann.id);
    const started = Date.now();
    await vi.waitFor(() => expect(readTrip(b.doc).name).toBe("Porto"), { timeout: 2000, interval: 20 });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("a browser's session cookie authenticates", async () => {
    const id = await newTrip(ann);
    const a = connect(server, id, { cookie: ann.cookie });
    await a.synced;
    expect(readTrip(a.doc).name).toBe(NEW_TRIP.name);
  });

  it("a non-member is refused with not-found", async () => {
    const eve = await signUpUser({ name: "Eve" });
    const id = await newTrip(ann);
    expect(await connect(server, id, as(eve)).refused).toBe("not-found");
    // A name that cannot be a trip id, and a trip that never existed, look the same.
    expect(await connect(server, "not-a-trip", as(eve)).refused).toBe("not-found");
    expect(await connect(server, newTripId(), as(eve)).refused).toBe("not-found");
  });

  it("a signed-out client is refused with unauthorized", async () => {
    const id = await newTrip(ann);
    expect(await connect(server, id, {}).refused).toBe("unauthorized");
    expect(await connect(server, id, { token: "not-a-session" }).refused).toBe("unauthorized");
  });

  it("a removed member's live connection is closed with removed", async () => {
    const id = await newTrip(ann, bob);
    const a = connect(server, id, as(ann));
    const b = connect(server, id, as(bob));
    await Promise.all([a.synced, b.synced]);
    await removeMember(id, bob.id);
    expect((await b.closed).reason).toBe("removed");
    // The owner stays connected and sees the member list shrink.
    await vi.waitFor(() => expect(readTrip(a.doc).members.map((m) => m.id)).toEqual([ann.id]));
  });

  it("a removed member's reconnect is refused with removed", async () => {
    const id = await newTrip(ann, bob);
    await removeMember(id, bob.id);
    expect(await connect(server, id, as(bob)).refused).toBe("removed");
  });

  it("deleting a trip closes connections with deleted", async () => {
    const id = await newTrip(ann, bob);
    const a = connect(server, id, as(ann));
    const b = connect(server, id, as(bob));
    await Promise.all([a.synced, b.synced]);
    await deleteTrip(id);
    expect((await a.closed).reason).toBe("deleted");
    expect((await b.closed).reason).toBe("deleted");
    expect(await connect(server, id, as(bob)).refused).toBe("deleted");
  });

  it("adding a member shows them in connected clients' members map", async () => {
    const id = await newTrip(ann);
    const a = connect(server, id, as(ann));
    await a.synced;
    await addMember(id, bob.id, "member");
    await vi.waitFor(() => expect(readTrip(a.doc).members.map((m) => m.name).sort()).toEqual(["Ann", "Bob"]));
  });

  it("storing a stale document never drops a server-side change", async () => {
    const id = await newTrip(ann);
    // A client's copy taken before the server added Bob, then edited.
    const stale = new Y.Doc();
    Y.applyUpdate(stale, (await loadState(id))!);
    await addMember(id, bob.id, "member");
    setTripMeta(stale, { name: "Edited offline" }, ann.id);
    await storeState(id, Y.encodeStateAsUpdate(stale));
    const { view } = await storedTrip(id);
    expect(view.name).toBe("Edited offline");
    expect(view.members.map((m) => m.name).sort()).toEqual(["Ann", "Bob"]);
  });

  it("connecting records activity", async () => {
    const cem = await signUpUser({ name: "Cem" }); // the server has not seen this user yet
    const id = await newTrip(cem);
    await db.update(user).set({ lastActiveAt: null }).where(eq(user.id, cem.id));
    await connect(server, id, as(cem)).synced;
    await vi.waitFor(async () => {
      const [row] = await db.select({ at: user.lastActiveAt }).from(user).where(eq(user.id, cem.id));
      expect(row.at).not.toBeNull();
    });
  });

  it("a 1.5 MB message closes the connection", async () => {
    const id = await newTrip(ann);
    const a = connect(server, id, as(ann));
    await a.synced;
    a.doc.getMap("meta").set("blob", "x".repeat(1.5 * 1024 * 1024));
    expect((await a.closed).code).toBe(1009); // "message too big"
  });

  it("an unknown top-level share closes only that connection", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await newTrip(ann, bob);
    const a = connect(server, id, as(ann));
    const b = connect(server, id, as(bob));
    await Promise.all([a.synced, b.synced]);
    a.doc.getMap("rogue").set("x", 1);
    expect((await a.closed).reason).toBe("invalid");
    expect(logged).toHaveBeenCalled(); // Hocuspocus logs the refused message
    // Bob is still connected: his edit reaches a fresh client, and nobody got the rogue share.
    addDay(b.doc, bob.id);
    const c = connect(server, id, as(ann));
    await c.synced;
    await vi.waitFor(() => expect(readTrip(c.doc).days).toHaveLength(NEW_TRIP.days + 1));
    expect(b.doc.share.has("rogue")).toBe(false);
    expect(c.doc.share.has("rogue")).toBe(false);
  });

  it("the 51st connection is refused", async () => {
    const id = await newTrip(ann);
    const fifty = Array.from({ length: 50 }, () => connect(server, id, as(ann)));
    await Promise.all(fifty.map((c) => c.synced));
    expect(await connect(server, id, as(ann)).refused).toBe("full");
  }, 30_000);

  it("an update past 200 places is accepted", async () => {
    const id = await newTrip(ann, bob);
    const a = connect(server, id, as(ann));
    const b = connect(server, id, as(bob));
    await Promise.all([a.synced, b.synced]);
    a.doc.transact(() => {
      for (let i = 0; i < 201; i++) addPlace(a.doc, { name: `Place ${i}`, category: "sight", dayId: null }, ann.id);
    });
    await vi.waitFor(() => expect(readTrip(b.doc).placeCount).toBe(201), { timeout: 5000 });
  });
});

/** The sync half of startServer on its own port: Next.js dev mode cannot start twice in one process. */
async function startSyncOnly(): Promise<RunningServer> {
  const sync = serveSync(createSyncServer());
  const http = createServer();
  http.on("upgrade", (req, socket, head) => sync.handleUpgrade(req, socket, head));
  await new Promise<void>((resolve) => http.listen(0, resolve));
  return {
    url: `http://localhost:${(http.address() as AddressInfo).port}`,
    async close() {
      await sync.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

describe("sync server restart", () => {
  afterEach(() => {
    for (const c of open.splice(0)) close(c);
  });

  it("a document survives a server restart", async () => {
    const ann = await signUpUser({ name: "Ann" });
    const bob = await signUpUser({ name: "Bob" });
    const id = await newTrip(ann, bob);
    let server = await startSyncOnly();
    try {
      const a = connect(server, id, as(ann));
      await a.synced;
      setTripMeta(a.doc, { name: "Before restart" }, ann.id);
      // Acknowledged by the server, but still inside the 2 s store debounce when the server stops.
      await vi.waitFor(() => expect(a.provider.hasUnsyncedChanges).toBe(false));
      await server.close();
      server = await startSyncOnly();
      const b = connect(server, id, as(bob));
      await b.synced;
      expect(readTrip(b.doc).name).toBe("Before restart");
    } finally {
      await server.close();
    }
  });
});

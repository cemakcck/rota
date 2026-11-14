import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import { placeNote, readTrip } from "@rota/trip";
import { db } from "@/server/db/client";
import { trips } from "@/server/db/schema";
import { startDemo } from "@/server/demo";
import { startFriends, stopFriends } from "@/server/friend";
import { createSyncServer, serveSync, type SyncEndpoint } from "@/server/sync";
import { markFriendRan } from "@/server/trips/repo";

type Seen = { cursor: { lat: number; lng: number } | null; editing: string | null };

/** The demo visitor's browser, as a Node client: the session cookie and "cookie" as the token. */
function connectAsVisitor(url: string, tripId: string, cookie: string) {
  class CookieWebSocket extends WebSocket {
    constructor(address: string) {
      super(address, { headers: { cookie } });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: `${url.replace("http", "ws")}/sync`, WebSocketPolyfill: CookieWebSocket });
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: tripId, document: doc, token: "cookie" });
  provider.attach();
  // Everything Selin publishes, in order.
  const selin: Seen[] = [];
  provider.awareness!.on("change", () => {
    provider.awareness!.getStates().forEach((state) => {
      if ((state as { user?: { name?: string } }).user?.name === "Selin") selin.push(state as Seen);
    });
  });
  const selinHere = () => [...provider.awareness!.getStates().values()].some((s) => (s as { user?: { name?: string } }).user?.name === "Selin");
  return {
    doc,
    selin,
    selinHere,
    synced: new Promise<void>((resolve) => provider.on("synced", () => resolve())),
    close() {
      provider.destroy();
      socket.destroy();
    },
  };
}

const noteText = (fragment: Y.XmlFragment) => fragment.toArray().map((p) => (p as Y.XmlElement).toArray().map((t) => (t as Y.XmlText).toString()).join(""));

describe("scripted friend", () => {
  let http: Server;
  let sync: SyncEndpoint;
  let url: string;
  const clients: { close(): void }[] = [];

  beforeAll(async () => {
    sync = serveSync(createSyncServer());
    http = createServer();
    http.on("upgrade", (req, socket, head) => sync.handleUpgrade(req, socket, head));
    await new Promise<void>((resolve) => http.listen(0, resolve));
    url = `http://localhost:${(http.address() as AddressInfo).port}`;
    startFriends(url);
  });

  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    stopFriends();
    await sync.close();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it("the friend runs once per demo trip, edits through sync and leaves", { timeout: 60_000 }, async () => {
    vi.stubEnv("FRIEND_DELAY_MS", "500");
    const { sessionCookie, tripId } = await startDemo({ ip: `198.51.100.1-${randomUUID()}`, locale: "en" });
    const cookie = sessionCookie.split(";")[0];
    // The owner's first connection starts the friend; the test watches through it.
    const visitor = connectAsVisitor(url, tripId, cookie);
    clients.push(visitor);
    await visitor.synced;
    const before = readTrip(visitor.doc);
    const selin = before.members.find((m) => m.name === "Selin")!;
    const [from, to] = before.days[0].places;
    const unticked = before.checklist.find((i) => !i.done)!;
    const notUpvoted = before.suggestions.find((s) => s.votes[selin.id] !== 1)!;

    // Selin arrives, works through her script and leaves.
    await vi.waitFor(() => expect(visitor.selin.length).toBeGreaterThan(0), { timeout: 10_000, interval: 20 });
    await vi.waitFor(
      () => {
        const now = readTrip(visitor.doc);
        expect(noteText(placeNote(visitor.doc, to.id)).at(-1)).toBe("Let's go early, it gets busy after 11.");
        expect(now.checklist.find((i) => i.id === unticked.id)?.done).toBe(true);
        expect([...now.suggestions, ...now.days.flatMap((d) => d.places)].find((p) => p.id === notUpvoted.id)?.votes[selin.id]).toBe(1);
        expect(visitor.selinHere()).toBe(false);
      },
      { timeout: 30_000, interval: 50 },
    );

    // Her cursor travelled from the first Day 1 pin to the second, then she edited that place.
    const cursors = visitor.selin.map((s) => s.cursor).filter((c) => c !== null);
    const distinct = new Set(cursors.map((c) => `${c.lat},${c.lng}`));
    expect(distinct.size).toBeGreaterThanOrEqual(8);
    expect(cursors[0]).toEqual({ lat: from.lat, lng: from.lng });
    expect(cursors.at(-1)).toEqual({ lat: to.lat, lng: to.lng });
    expect(visitor.selin.some((s) => s.editing === to.id)).toBe(true);
    expect(noteText(placeNote(visitor.doc, to.id)).filter((p) => p.startsWith("Let's go early"))).toHaveLength(1);

    // Once per demo trip: the mark is taken, and the owner coming back does not bring her again.
    const [row] = await db.select({ friendRanAt: trips.friendRanAt }).from(trips).where(eq(trips.id, tripId));
    expect(row.friendRanAt).toBeInstanceOf(Date);
    expect(await markFriendRan(tripId)).toBe(false);
    const again = connectAsVisitor(url, tripId, cookie);
    clients.push(again);
    await again.synced;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(again.selin).toEqual([]);
  });
});

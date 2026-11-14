import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Database } from "@hocuspocus/extension-database";
import { Hocuspocus, type Connection, type Document } from "@hocuspocus/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { SHARES, isTripId } from "@rota/trip";
import { getSessionFromRequest } from "./auth";
import { db } from "./db/client";
import { tripMembers, tripTombstones, trips } from "./db/schema";
import { scheduleFriend } from "./friend";
import { toHeaders } from "./ipHash";
import { HttpError } from "./httpError";
import { requireMember } from "./trips/access";
import { loadState, storeState } from "./trips/docStore";
import { liveSyncServer, setLiveSyncServer } from "./trips/live";
import { touchUser } from "./trips/repo";

// Each trip is one Yjs document named by its trip id. Clients authenticate with `token`: a bearer
// token when they have one (mobile app, friend windows), else "cookie" and the upgrade request's
// session cookie is used. Refusals reach the client as the reason of a permission-denied message
// ("unauthorized" | "not-found" | "removed" | "deleted" | "full"); live connections are closed with
// "removed", "deleted" (trips/live.ts), "invalid" or "full".
//
// Limits never eat offline work: a member's update is never refused for its size or for the soft
// caps (places, checklist, document size), which are enforced in the interface only.

/**
 * WebSocket messages over this size close the socket (Ruling T6-a). Four times the 2 MB document soft
 * cap: an offline diff goes up as one message on reconnect, and a lower cap would close the socket on
 * every reconnect so that work would never sync. An offline edit must never silently vanish.
 */
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_CONNECTIONS_PER_TRIP = 50;
const STORE_DEBOUNCE_MS = 2000;
const STORE_MAX_DEBOUNCE_MS = 10_000;
const TOUCH_EVERY_MS = 60_000;

type Context = { userId: string };
type Reason = "unauthorized" | "not-found" | "removed" | "deleted" | "full" | "invalid";

/** Hocuspocus sends a thrown object's `reason` to the client. It has no `message`, so nothing is logged. */
const refuse = (reason: Reason) => ({ reason });

const SHARE_NAMES = new Set<string>(SHARES);

/** True when the update creates content in a top-level share outside the trip schema. */
function addsUnknownShare(update: Uint8Array): boolean {
  // Only an item that starts a share's content names the share; later ones point at their neighbours.
  return Y.decodeUpdate(update).structs.some((s) => s instanceof Y.Item && typeof s.parent === "string" && !SHARE_NAMES.has(s.parent));
}

/** Why a signed-in user may not open the trip, or null if they may. */
async function accessDenied(userId: string, tripId: string): Promise<Reason | null> {
  try {
    await requireMember(userId, tripId);
    return null;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return whyNotMember(userId, tripId);
    throw err;
  }
}

/** Removal and deletion are told apart on purpose. */
async function whyNotMember(userId: string, tripId: string): Promise<Reason> {
  const [tombstone] = await db.select({ id: tripTombstones.tripId }).from(tripTombstones).where(eq(tripTombstones.tripId, tripId));
  if (tombstone) return "deleted";
  const [removed] = await db
    .select({ userId: tripMembers.userId })
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId), isNotNull(tripMembers.removedAt)));
  return removed ? "removed" : "not-found";
}

/** A demo trip's owner opening it brings the scripted friend, the first time only (friend.ts). */
async function friendFor(userId: string, tripId: string): Promise<void> {
  const [trip] = await db.select({ ownerId: trips.ownerId, isDemo: trips.isDemo, friendRanAt: trips.friendRanAt }).from(trips).where(eq(trips.id, tripId));
  if (trip?.isDemo && trip.ownerId === userId && !trip.friendRanAt) scheduleFriend(tripId);
}

const liveConnections = (document: Document | undefined) => document?.getConnections().length ?? 0;

/** The sync server for this process. It also becomes the target of server-side changes (trips/live.ts). */
export function createSyncServer(): Hocuspocus<Context> {
  const lastTouched = new Map<string, number>();
  /** Activity feeds demo cleanup; recorded at most once a minute per user. */
  const touch = (userId: string | undefined) => {
    if (!userId) return;
    const now = Date.now();
    if (now - (lastTouched.get(userId) ?? 0) < TOUCH_EVERY_MS) return;
    lastTouched.set(userId, now);
    touchUser(userId).catch((err) => console.error("[sync] could not record activity", err));
  };

  // Between onAuthenticate and the connection joining its document, Hocuspocus loads the document
  // (seconds on a cold database). A removal or deletion committed in that window cannot see the
  // connection to close it (trips/live.ts). So access is checked once more after the connection has
  // joined the document, and every message from it waits for that check: nothing it sends is applied
  // unless the user was still a member at a moment when any later removal would find and close it.
  const rechecks = new WeakMap<Connection<Context>, Promise<Reason | null>>();
  const recheck = (connection: Connection<Context>) => {
    let pending = rechecks.get(connection);
    if (!pending) {
      pending = accessDenied(connection.context.userId, connection.document.name);
      rechecks.set(connection, pending);
    }
    return pending;
  };

  const hocuspocus = new Hocuspocus<Context>({
    name: "rota-sync",
    quiet: true,
    debounce: STORE_DEBOUNCE_MS,
    maxDebounce: STORE_MAX_DEBOUNCE_MS,
    extensions: [
      new Database({
        fetch: ({ documentName }) => loadState(documentName),
        // storeState merges, so server-side changes stored in between are never overwritten.
        store: ({ documentName, state }) => storeState(documentName, state),
      }),
    ],

    async onAuthenticate({ documentName, token, request, instance }): Promise<Context> {
      if (!isTripId(documentName)) throw refuse("not-found");
      const session = await getSessionFromRequest(request, token && token !== "cookie" ? token : undefined);
      if (!session) throw refuse("unauthorized");
      const userId = session.user.id;
      const denied = await accessDenied(userId, documentName);
      if (denied) throw refuse(denied);
      if (liveConnections(instance.documents.get(documentName)) >= MAX_CONNECTIONS_PER_TRIP) throw refuse("full");
      return { userId };
    },

    async connected({ connection, context }) {
      // Connections authenticated at the same moment can all pass the check above; this one cannot be raced.
      if (liveConnections(connection.document) > MAX_CONNECTIONS_PER_TRIP) {
        connection.close({ code: 4429, reason: "full" });
        return;
      }
      // Closes a connection that never sends anything, so it stops receiving the trip too.
      const denied = await recheck(connection);
      if (denied) {
        connection.close({ code: 4403, reason: denied });
        return;
      }
      touch(context.userId);
      friendFor(context.userId, connection.document.name).catch((err) => console.error("[sync] could not schedule the friend", err));
    },

    async beforeHandleMessage({ connection }) {
      const denied = await recheck(connection);
      if (denied) throw refuse(denied);
    },

    async onChange({ context }) {
      touch(context?.userId);
    },

    async beforeSync({ type, payload }) {
      // 0 is a state vector; 1 (sync step 2) and 2 (update) carry document content.
      if (type !== 0 && addsUnknownShare(payload)) throw refuse("invalid");
    },
  });
  setLiveSyncServer(hocuspocus);
  return hocuspocus;
}

export type SyncEndpoint = {
  /** Takes over an HTTP upgrade request for `/sync`. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Closes every socket and stores every loaded document. */
  close(): Promise<void>;
};

/** Serves a sync server over WebSockets. Messages over 1 MB close the socket (code 1009). */
export function serveSync(hocuspocus: Hocuspocus<Context>): SyncEndpoint {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  wss.on("connection", (ws, req: IncomingMessage) => {
    const request = new Request(new URL(req.url ?? "/sync", "http://localhost"), { headers: toHeaders(req) });
    const client = hocuspocus.handleConnection(ws, request);
    ws.on("message", (data: Buffer) => client.handleMessage(data));
    ws.on("pong", () => client.touch());
    ws.on("close", (code, reason) => client.handleClose({ code, reason: reason.toString() }));
    // ws closes the socket itself after an error (e.g. 1009 for an oversized message).
    ws.on("error", () => {});
  });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    },
    async close() {
      if (liveSyncServer() === hocuspocus) setLiveSyncServer(undefined);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await Promise.all(
        [...hocuspocus.documents.values()].map((document) =>
          hocuspocus.storeDocumentHooks(
            document,
            { instance: hocuspocus, clientsCount: 0, document, documentName: document.name, lastContext: {}, lastTransactionOrigin: undefined },
            true,
          ),
        ),
      );
    },
  };
}

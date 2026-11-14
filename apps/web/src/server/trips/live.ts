import type { Hocuspocus } from "@hocuspocus/server";
import { eq } from "drizzle-orm";
import type * as Y from "yjs";
import { db } from "../db/client";
import { tripDocuments } from "../db/schema";
import { HttpError } from "../httpError";
import { mutateStoredDoc } from "./docStore";

// Server-side edits to trip documents (membership mirrors, meta from the API) go through here.
// While this process runs the sync server, they are applied to the live document so connected
// clients see them at once and the next store cannot overwrite them. Without a sync server (scripts,
// tests that call the repo directly) they fall back to a locked edit of the stored state.
//
// The running instance sits on globalThis because Next.js bundles route handlers separately from
// server.ts: a module-level variable here would be a different copy in each bundle.

const g = globalThis as unknown as { __rotaSync?: Hocuspocus };

/** Called by the sync server when it starts and stops. */
export function setLiveSyncServer(instance: Hocuspocus | undefined): void {
  g.__rotaSync = instance;
}

export function liveSyncServer(): Hocuspocus | undefined {
  return g.__rotaSync;
}

/** Applies `change` to the trip's document. 404 when the trip has no document. */
export async function applyServerChange(tripId: string, change: (doc: Y.Doc) => void): Promise<void> {
  const sync = g.__rotaSync;
  if (!sync) return mutateStoredDoc(tripId, change);
  // A direct connection would happily create an empty document for a trip that does not exist.
  if (!sync.documents.has(tripId)) {
    const [row] = await db.select({ id: tripDocuments.tripId }).from(tripDocuments).where(eq(tripDocuments.tripId, tripId));
    if (!row) throw new HttpError(404, "not_found");
  }
  const connection = await sync.openDirectConnection(tripId);
  try {
    await connection.transact(change);
  } finally {
    // Stores immediately (a merge, see docStore) and unloads the document if nobody is connected.
    await connection.disconnect();
  }
}

export type CloseReason = "removed" | "deleted";

/** Closes the user's live connections to the trip, telling their clients why. */
export function disconnectUser(tripId: string, userId: string, reason: CloseReason): void {
  const document = g.__rotaSync?.documents.get(tripId);
  for (const connection of document?.getConnections() ?? []) {
    if ((connection.context as { userId?: string }).userId === userId) connection.close({ code: 4403, reason });
  }
}

import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { readTrip } from "@rota/trip";
import { db, type Db } from "../db/client";
import { tripDocuments, trips } from "../db/schema";
import { HttpError } from "../httpError";

// The stored Yjs state of each trip. Every write is a merge under a row lock: a stored document
// only ever gains what the writer brings, so no writer can drop another's change, and a retried
// write (the DB client retries whole transactions) applies the same CRDT update twice, harmlessly.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function loadState(id: string): Promise<Uint8Array | null> {
  const [row] = await db.select({ state: tripDocuments.state }).from(tripDocuments).where(eq(tripDocuments.tripId, id));
  return row?.state ?? null;
}

/**
 * Locks the stored document, lets `change` edit it and writes it back with the denormalised trip
 * columns (`name`, `start_date`, `days`, `destination`, `updated_at`) synced from its meta.
 * False when the trip has no document (it was deleted).
 */
async function mutate(tripId: string, change: (doc: Y.Doc) => void): Promise<boolean> {
  return db.transaction(async (tx: Tx) => {
    const [row] = await tx.select({ state: tripDocuments.state }).from(tripDocuments).where(eq(tripDocuments.tripId, tripId)).for("update");
    if (!row) return false;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.state);
    change(doc);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const view = readTrip(doc);
    const now = new Date();
    await tx.update(tripDocuments).set({ state, sizeBytes: state.length, updatedAt: now }).where(eq(tripDocuments.tripId, tripId));
    await tx
      .update(trips)
      .set({ name: view.name, startDate: view.startDate, days: view.days.length, destination: view.destination, updatedAt: now })
      .where(eq(trips.id, tripId));
    return true;
  });
}

/** Merges a document state into the stored one. A deleted trip's state is dropped. */
export async function storeState(id: string, state: Uint8Array): Promise<void> {
  await mutate(id, (doc) => Y.applyUpdate(doc, state));
}

/** Applies a server-side change to the stored document. 404 when the trip has no document. */
export async function mutateStoredDoc(tripId: string, change: (doc: Y.Doc) => void): Promise<void> {
  if (!(await mutate(tripId, change))) throw new HttpError(404, "not_found");
}

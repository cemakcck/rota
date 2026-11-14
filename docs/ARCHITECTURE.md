# Rota architecture: sync and offline

The [README](../README.md) gives the overview. This note follows one edit from a keystroke to every other device, and covers what happens when something on the way is missing: the network, the tab, the membership or the database.

## The pieces

| Piece | Where | Job |
| --- | --- | --- |
| Trip document | `packages/trip/src/doc.ts`, `schema.ts` | One `Y.Doc` per trip with five top-level maps: `meta` (name, dates, destination), `places`, `days`, `checklist`, `members` (a display mirror). Notes are `Y.XmlFragment`s inside their place or day. |
| Ordering | `packages/trip/src/order.ts` | Fractional-index keys and the tie rekeying described below. |
| Read model | `packages/trip/src/view.ts` | Turns the document into sorted, validated lists for the UI. Peers can write anything, so it never trusts a key or a reference. |
| Client sync | `apps/web/src/client/sync/useTrip.ts` | IndexedDB copy (y-indexeddb), the Hocuspocus provider, the tab relay, the sync status. |
| Pending changes | `apps/web/src/client/sync/pending.ts` | "N changes waiting", per user, across tabs. |
| Sync server | `apps/web/src/server/sync.ts` | Hocuspocus with membership checks, limits and persistence. |
| Server-side edits | `apps/web/src/server/trips/live.ts` | API routes edit the live document through the running sync server. |
| Storage | `apps/web/src/server/trips/docStore.ts` | `trip_documents.state`: the Yjs state, written by merging under a row lock. |
| Service worker | `apps/web/src/sw/sw.js` | Pages, static files and map tiles for offline use. |

## One edit, start to finish

1. **The UI writes to the local document** in a transaction whose origin is the user's id. That origin is what per-person undo tracks (`packages/trip/src/undo.ts`), and what tells "my edit" apart from updates that arrived from the server, IndexedDB or another tab.
2. **y-indexeddb stores the update** on the device. From here the edit survives a reload, a crash or a week offline.
3. **The pending set records it.** `changedRecords` maps the transaction to the records it touched (`places:<id>`, `days:<id>`, `checklist:<id>`, `meta`) and adds them to this tab's entry in `localStorage`. Ten keystrokes in one note are one record.
4. **The tab relay copies it to the user's other tabs** of the same trip over a `BroadcastChannel` named for the trip and the user. Each tab's document therefore holds all of that user's edits, so whichever tab is connected delivers them.
5. **The provider sends it** over `/sync` when connected. Hocuspocus checks the connection's access (see below) before applying anything, applies the update to the server's copy and broadcasts it to the other connections.
6. **The acknowledgement clears the pending entry.** Once the provider reports no unsynced changes, the tab removes its entry; the header shows "Synced" when no tab of the user has records left.
7. **The server stores the document**, debounced (2 s, at most 10 s). `storeState` merges the new state into the stored one under a row lock rather than overwriting it, so a server-side change stored in between is never lost, and a retried write applies the same CRDT update twice, harmlessly.

## Ordering without duplicates

A list in a shared document is tempting as a `Y.Array` of ids. A move is then "delete here, insert there", and two people moving the same place at the same time produce two inserts: the place appears twice. `packages/trip/test/merge.test.ts` keeps that failure as a test.

Instead, each place carries `dayId` (or Ideas) and an `order` key from [fractional-indexing](https://github.com/rocicorp/fractional-indexing). A move sets both fields on the one record. Each field is last-writer-wins, so concurrent moves pick one destination and the place exists exactly once. Sorting is by key, then by id, so every device shows the same order.

One edge needs care. Two people appending to the same day at the same moment generate the same key, and no key sorts strictly between two equal keys. `planSlot` handles a drop into such a tied group by generating fresh keys for the drop and for the tied items after it, written in the same transaction. Each of those is again a single-field write, so the worst a concurrent edit can do is reorder, never duplicate or lose.

## Offline

- **Opening a trip.** The local copy loads first; the provider attaches only after that, so its first sync step sends the whole offline state as one update instead of trickling it out while the server is still authenticating. A trip never opened on this device shows "Connect once to download this trip".
- **The page itself.** The service worker serves pages network-first with the last copy as fallback (the shell, My trips and every trip page visited), static files cache-first in a cache named for the build, and OpenFreeMap tiles cache-first up to 2000. Pages reached by in-app navigation never pass through the worker as page loads, so the app asks the worker to keep them: one online visit is enough to open a page offline. `/api/*` and `/sync` are never touched.
- **Per-build caches.** `/sw.js` is generated by a route that fills in `.next/BUILD_ID`. A new build means a new worker, which deletes the previous build's page and static caches when it activates. Tiles and the map style are kept across builds.
- **The count.** "Offline — N changes waiting" is the union of the user's tabs' pending entries. Entries are per user because in the demo one browser is two people. Each tab beats a heartbeat into its entry; a tab that stops beating for 3 minutes (crashed, frozen, or hidden with throttled timers), says it is closing, or cannot sync is adopted by a tab that can. The adopting tab re-reads IndexedDB first, so its document holds whatever the dead tab stored, and only then takes over the records: its next acknowledgement covers them.
- **Simulate offline.** The demo's switch makes the tab behave like an offline device: the provider disconnects and the tab neither sends nor applies relayed edits. Switching back exchanges state vectors with the other tabs and reconnects.

## Who may sync

Every trip is one Hocuspocus document named by its trip id. A connection authenticates with the session cookie of the upgrade request, or with a bearer token (friend windows now, the mobile app later). `trip_members` is the source of truth.

1. **`onAuthenticate`** refuses a bad trip id, a missing session, a non-member, and the 51st connection to a trip. The refusal carries a reason (`unauthorized`, `not-found`, `removed`, `deleted`, `full`), and the client shows the matching message.
2. **The connect race.** Between authentication and the connection joining its document, Hocuspocus loads the document, which can take seconds on a cold database. A removal committed in that window looks for live connections to close and does not find this one yet. So once the connection has joined, access is checked again, and every message from that connection waits for the result. Nothing it sends is applied unless the user was still a member at a moment when any later removal would find and close the connection.
3. **Live removal and deletion.** Removing a member or deleting a trip closes the affected connections with `removed` or `deleted`. The device stops reconnecting; edits made after that are discarded with the message shown, never silently.
4. **Schema guard.** An update that creates a top-level share outside the trip schema closes only that connection.

## Limits that never eat offline work

The server never refuses a member's update because of its size or the soft caps. A long offline session goes up as one message on reconnect, and refusing it would refuse it on every reconnect: the work would never sync. So:

- Soft caps (2 MB document, 200 places, 100 checklist items) are enforced in the interface only.
- The WebSocket message cap is 8 MB, four times the soft document cap. It exists to stop abuse, not to police trips; a test sends a 1.5 MB offline update through and an 8.5 MB message closes the socket.

## Server-side edits and the single Yjs

Some edits start on the server, such as changing a trip's name or dates through the API and mirroring members' names and colours into the document. (Selin, the scripted friend, is not one of them: she connects to `/sync` as a client.) They go through `applyServerChange`, which opens a direct connection to the live document in the running sync server, so connected clients see the change at once and the next debounced store cannot overwrite it. Without a running sync server (scripts, some tests) it falls back to a locked edit of the stored state.

This only works if there is one copy of Yjs in the process: Yjs types created by one copy fail the `instanceof` checks of another. Next.js would bundle `yjs` into the route handlers as a second copy, so `next.config.ts` lists it in `serverExternalPackages`. Route handlers and `server.ts` are bundled separately, so the running sync server is shared through `globalThis.__rotaSync`. An integration test against a production build fails if a second Yjs ever loads. The production image bundles `server.ts` with esbuild but leaves every npm package, `yjs` included, as an import of `node_modules`, so it keeps that property.

## One port

`server.ts` creates a plain Node HTTP server. Requests go to Next's handler; `upgrade` events for `/sync` go to the WebSocket server in front of Hocuspocus.

Next complicates this: on the first request it handles, it attaches its own `upgrade` listener to the server, and that listener runs Next's router on every upgrade, `/sync` included. `/sync` matches the `/[locale]` page, so Next ended the socket the sync server had just accepted. The fix gives Next a second HTTP server that never listens (`httpServer` in Next's options): its listener lands there, and `server.ts` forwards only non-`/sync` upgrades to it (HMR in development). `tests/integration/server.test.ts` covers both sides.

## The database and Neon

Neon's free tier suspends idle databases and drops the first connections when it resumes. Every query goes through `withDbRetry` (`apps/web/src/server/db/client.ts`): connection-class errors (`ECONNRESET`, `ECONNREFUSED`, `57P01`, `08006`, …) are retried with exponential backoff, four attempts in all, and nothing else is. The drizzle object is wrapped so builders, transactions and migrations all take that path. Writes are idempotent or CRDT merges, so a retry after a commit whose reply was lost does no harm.

In the container, `node dist/migrate.mjs` runs before `node dist/server.mjs`; the migration retries the same way while Neon wakes. `/api/health` never touches the database, so a sleeping database never fails Railway's health check.

## Client IPs

Rate limits (sign-ups and demo starts per day, proxy calls per minute) key on an HMAC of the client IP; raw IPs are never stored. `clientIp` takes the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` places from the end (default 1), because entries before those added by trusted proxies are whatever the client sent.

Railway's edge is the one hop in production. Railway's [public networking docs](https://docs.railway.com/networking/public-networking/specs-and-limits) name `X-Real-IP` as the client's address; a [Railway staff answer](https://station.railway.com/questions/which-client-address-headers-does-the-ra-fb9e36d7) says the edge overwrites `X-Forwarded-For` and `X-Real-IP`, while [other users report](https://station.railway.com/questions/edge-proxy-x-forwarded-for-and-x-real-ip-c5a50049) that client-sent values come through with the real address appended. Taking the last entry is right in both cases. Next.js itself only sets `X-Forwarded-For` when it is missing, so it adds no hop.

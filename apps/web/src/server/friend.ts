import { setTimeout as sleep } from "node:timers/promises";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { placeNote, readTrip, updateChecklistItem, vote, type Locale } from "@rota/trip";
import { demoUserToken } from "./demo";
import { markFriendRan } from "./trips/repo";

// The scripted friend (spec §11): a while after a demo trip's owner first opens it, Selin joins through
// the real sync path as a server-side client, points along Day 1 on the map, opens a place and adds to
// its note, votes on a suggestion, ticks a checklist item, and leaves. Once per demo trip.

const NOTE: Record<Locale, string> = {
  en: "Let's go early, it gets busy after 11.",
  tr: "Erken gidelim, 11'den sonra kalabalık oluyor.",
};
/** Points of her cursor's path, from the first Day 1 pin to the second (both included). */
const CURSOR_POINTS = 8;
const CONNECT_TIMEOUT_MS = 15_000;
const FLUSH_TIMEOUT_MS = 5000;

/** This process's own server, which the friend connects to; unset until it listens. */
let serverUrl: string | undefined;
const running = new Set<AbortController>();

/** The friend may run, connecting to the server at `url` (the custom server, once it listens). */
export function startFriends(url: string): void {
  serverUrl = url;
}

/** Stops every scheduled or running friend; none start until `startFriends` again. */
export function stopFriends(): void {
  serverUrl = undefined;
  for (const run of running) run.abort();
}

/**
 * Schedules Selin for the demo trip, unless she has already been scheduled for it (now or ever).
 * Errors end her script silently (logged).
 */
export function scheduleFriend(tripId: string, { delayMs = Number(process.env.FRIEND_DELAY_MS ?? 10_000), stepMs = 900 } = {}): void {
  const url = serverUrl;
  if (!url) return;
  const run = new AbortController();
  running.add(run);
  void (async () => {
    try {
      if (!(await markFriendRan(tripId))) return;
      await sleep(delayMs, undefined, { signal: run.signal });
      await playSelin(url, tripId, stepMs, run.signal);
    } catch (err) {
      if (!run.signal.aborted) console.error("[friend] Selin stopped", err);
    } finally {
      running.delete(run);
    }
  })();
}

async function playSelin(url: string, tripId: string, stepMs: number, signal: AbortSignal): Promise<void> {
  const { token, user } = await demoUserToken(tripId, "Selin");
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${url.replace(/^http/, "ws")}/sync`, WebSocketPolyfill: WebSocket });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: tripId, document: doc, token });
  const step = (ms = stepMs) => sleep(ms, undefined, { signal });
  try {
    const synced = new Promise<void>((resolve, reject) => {
      provider.on("synced", () => resolve());
      provider.on("authenticationFailed", ({ reason }: { reason: string }) => reject(new Error(`refused: ${reason}`)));
    });
    provider.attach();
    await until(synced, AbortSignal.any([signal, AbortSignal.timeout(CONNECT_TIMEOUT_MS)]));

    const trip = readTrip(doc);
    const [from, to] = trip.days[0]?.places.filter((p) => p.lat !== null && p.lng !== null) ?? [];
    if (!from || !to) throw new Error("Day 1 has fewer than two pins");
    const awareness = provider.awareness!;
    awareness.setLocalState({ user, editing: null, cursor: null });

    // Her pointer glides from one pin to the next.
    for (let i = 0; i < CURSOR_POINTS; i++) {
      const f = i / (CURSOR_POINTS - 1);
      awareness.setLocalStateField("cursor", { lat: from.lat! + (to.lat! - from.lat!) * f, lng: from.lng! + (to.lng! - from.lng!) * f });
      await step(stepMs / 3);
    }
    awareness.setLocalStateField("editing", to.id);
    await step();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText(NOTE[trip.locale])]);
    doc.transact(() => {
      const note = placeNote(doc, to.id);
      note.insert(note.length, [paragraph]);
    }, user.id);
    await step();
    awareness.setLocalStateField("editing", null);

    // The first suggestion she has not upvoted yet (one she already likes would show no change).
    const suggestion = readTrip(doc).suggestions.find((s) => s.votes[user.id] !== 1);
    if (suggestion) vote(doc, suggestion.id, user.id, 1);
    await step();
    const item = readTrip(doc).checklist.find((i) => !i.done);
    if (item) updateChecklistItem(doc, item.id, { done: true }, user.id);
    await step();

    awareness.setLocalState(null);
    // Leave once the server has everything she did.
    for (let waited = 0; provider.hasUnsyncedChanges && waited < FLUSH_TIMEOUT_MS; waited += 50) await step(50);
  } finally {
    provider.destroy();
    socket.destroy();
  }
}

/** `ready`, or a rejection once `signal` aborts. */
function until(ready: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    ready.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

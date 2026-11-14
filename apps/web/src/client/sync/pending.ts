import * as Y from "yjs";

// "N changes waiting" (spec §10) counts the records changed on this device that the server has not
// acknowledged yet: each place, day and checklist item once, and the trip's settings once. Typing a
// note is one change to its place, not one per keystroke.
//
// Every tab keeps its own entry, `rota.pending.<tripId>.<tabId>` = { keys, heartbeat }, and clears only
// that entry once its connection has the server's acknowledgement; the count is the union over all
// tabs. A user's open tabs relay their edits to each other (useTrip's BroadcastChannel), so each tab's
// document, and so what its provider sends, holds that user's edits from every tab. A tab that stopped beating (frozen, crashed),
// said it was closing, or cannot sync is adopted by a tab with a provider: that tab first re-reads
// IndexedDB into its document, then takes the records over, so its next acknowledgement covers them.

export const PENDING_HEARTBEAT_MS = 5000;
/** Hidden tabs' timers may run only once a minute, so a tab is presumed gone only after 3 minutes without a beat. */
export const PENDING_STALE_MS = 3 * 60_000;

/** Any shared type, whatever its event type. */
type YType = (typeof Y.AbstractType)["prototype"];

type Entry = { keys: string[]; heartbeat: number };

const prefix = (tripId: string) => `rota.pending.${tripId}.`;

/** Record key for the top-level share entry a change sits under; null for changes that are not counted. */
function recordKey(share: string, key: string | null): string | null {
  if (share === "meta") return "meta";
  if ((share === "places" || share === "days" || share === "checklist") && key) return `${share}:${key}`;
  return null;
}

/** The records a transaction changed, as `meta` or `<share>:<id>`. Member changes are not counted. */
export function changedRecords(transaction: Y.Transaction): string[] {
  const shareNames = new Map<YType, string>();
  transaction.doc.share.forEach((type, name) => shareNames.set(type, name));
  const keys = new Set<string>();
  transaction.changed.forEach((subs, changed) => {
    let type: YType = changed;
    let share = shareNames.get(type);
    if (share !== undefined) {
      // A top-level map: its changed keys are the records added, replaced or deleted.
      for (const sub of subs) {
        const key = recordKey(share, sub);
        if (key) keys.add(key);
      }
      return;
    }
    // Nested: walk up to the entry directly under a top-level share.
    while (type._item) {
      const parent = type._item.parent;
      if (!(parent instanceof Y.AbstractType)) return;
      share = shareNames.get(parent);
      if (share !== undefined) {
        const key = recordKey(share, type._item.parentSub);
        if (key) keys.add(key);
        return;
      }
      type = parent;
    }
  });
  return [...keys];
}

function readEntry(storageKey: string): Entry | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const { keys, heartbeat } = value as Record<string, unknown>;
    if (!Array.isArray(keys) || typeof heartbeat !== "number") return null;
    return { keys: keys.filter((k): k is string => typeof k === "string"), heartbeat };
  } catch {
    return null;
  }
}

function writeEntry(storageKey: string, entry: Entry): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(entry));
  } catch {
    // Storage full or blocked: the count is then only as good as this tab's memory.
  }
}

function storageKeys(tripId: string): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix(tripId))) out.push(key);
    }
  } catch {
    // Storage blocked.
  }
  return out;
}

/** True if a storage event key belongs to this trip's pending entries (null: storage was cleared). */
export function isPendingStorageKey(tripId: string, key: string | null): boolean {
  return key === null || key.startsWith(prefix(tripId));
}

/** Distinct records waiting across every tab. */
export function pendingCount(tripId: string): number {
  const all = new Set<string>();
  for (const key of storageKeys(tripId)) for (const record of readEntry(key)?.keys ?? []) all.add(record);
  return all.size;
}

/** Adds records to this tab's entry. */
export function recordPending(tripId: string, tabId: string, keys: string[], now: number = Date.now()): void {
  const storageKey = prefix(tripId) + tabId;
  const mine = readEntry(storageKey)?.keys ?? [];
  writeEntry(storageKey, { keys: [...new Set([...mine, ...keys])], heartbeat: now });
}

/** Marks this tab's entry (if any) as alive. */
export function heartbeatPending(tripId: string, tabId: string, now: number = Date.now()): void {
  const storageKey = prefix(tripId) + tabId;
  const mine = readEntry(storageKey);
  if (mine) writeEntry(storageKey, { keys: mine.keys, heartbeat: now });
}

/** The tab is closing: its entry (if any) is stale at once, so another tab adopts it at its next beat. */
export function closePending(tripId: string, tabId: string): void {
  heartbeatPending(tripId, tabId, 0);
}

/** This tab's changes are all on the server. */
export function clearPending(tripId: string, tabId: string): void {
  try {
    localStorage.removeItem(prefix(tripId) + tabId);
  } catch {
    // Storage blocked.
  }
}

/** True if another tab's entry is stale (or unreadable) and so waits to be adopted. */
export function hasStalePending(tripId: string, tabId: string, now: number = Date.now()): boolean {
  const own = prefix(tripId) + tabId;
  return storageKeys(tripId).some((key) => {
    if (key === own) return false;
    const entry = readEntry(key);
    return !entry || now - entry.heartbeat > PENDING_STALE_MS;
  });
}

/** Takes over the records of tabs that stopped beating (and drops unreadable entries). */
export function adoptStalePending(tripId: string, tabId: string, now: number = Date.now()): void {
  const own = prefix(tripId) + tabId;
  const adopted: string[] = [];
  for (const key of storageKeys(tripId)) {
    if (key === own) continue;
    const entry = readEntry(key);
    if (entry && now - entry.heartbeat <= PENDING_STALE_MS) continue;
    adopted.push(...(entry?.keys ?? []));
    clearPending(tripId, key.slice(prefix(tripId).length));
  }
  if (adopted.length > 0) recordPending(tripId, tabId, adopted, now);
}

/** Removes every tab's entry for the trip (the trip is gone from this device). */
export function forgetPending(tripId: string): void {
  for (const key of storageKeys(tripId)) clearPending(tripId, key.slice(prefix(tripId).length));
}

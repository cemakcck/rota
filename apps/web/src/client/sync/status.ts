export type SyncStatus = { kind: "synced" | "syncing" | "offline"; pending: number };

/**
 * The header's sync indicator (spec §10): "Synced", "Syncing…" or "Offline — N changes waiting".
 * `online` is the browser's network state (false while "Simulate offline" is on), `connected` the
 * sync socket, `synced` the first handshake with the server, `unsynced` local changes the server has not
 * acknowledged yet (kept across reloads).
 */
export function syncStatus(input: { online: boolean; connected: boolean; synced: boolean; unsynced: number }): SyncStatus {
  const pending = input.unsynced;
  if (!input.online) return { kind: "offline", pending };
  // Online but the socket is still connecting (or retrying): the work is on its way.
  if (!input.connected || !input.synced || pending > 0) return { kind: "syncing", pending };
  return { kind: "synced", pending };
}

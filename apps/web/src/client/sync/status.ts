export type SyncStatus = { kind: "synced" | "syncing" | "offline"; pending: number };

/**
 * The header's sync indicator (spec §10): "Synced", "Syncing…" or "Offline — N changes waiting".
 * `online` is the browser's network state (false while "Simulate offline" is on), `connected` the
 * sync socket, `synced` the first handshake with the server, `unsynced` local updates not yet acknowledged.
 */
export function syncStatus(input: { online: boolean; connected: boolean; synced: boolean; unsynced: number }): SyncStatus {
  const pending = input.unsynced;
  if (!input.online || !input.connected) return { kind: "offline", pending };
  if (!input.synced || pending > 0) return { kind: "syncing", pending };
  return { kind: "synced", pending };
}

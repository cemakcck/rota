type SignalSource = { on(event: "SIGTERM" | "SIGINT", listener: () => void): unknown };

/**
 * On SIGTERM (a deploy or restart) or SIGINT, closes the server, which stores every loaded document
 * still inside the sync store debounce, then exits: without it a deploy loses up to 10 s of edits the
 * server already acknowledged. A close that hangs past `graceMs` is cut off, so the process still ends.
 */
export function exitOnSignals(
  server: { close(): Promise<void> },
  {
    proc = process as SignalSource,
    exit = (code: number) => process.exit(code),
    log = (message: string, err?: unknown) => (err ? console.error(message, err) : console.log(message)),
    graceMs = 10_000,
  }: { proc?: SignalSource; exit?: (code: number) => void; log?: (message: string, err?: unknown) => void; graceMs?: number } = {},
): void {
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`[server] ${signal}: storing documents and shutting down`);
    const timer = setTimeout(() => {
      log("[server] shutdown timed out");
      exit(1);
    }, graceMs);
    timer.unref?.();
    server.close().then(
      () => {
        clearTimeout(timer);
        exit(0);
      },
      (err) => {
        clearTimeout(timer);
        log("[server] shutdown failed", err);
        exit(1);
      },
    );
  };
  // Kept registered: a second signal while closing is ignored rather than killing the process.
  for (const signal of ["SIGTERM", "SIGINT"] as const) proc.on(signal, () => stop(signal));
}

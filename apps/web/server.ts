import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import next from "next";
import { startCleanup } from "./src/server/cleanup";
import { createSyncServer, serveSync } from "./src/server/sync";

export type RunningServer = { url: string; close(): Promise<void> };

/** One Node process, one port: Next.js serves pages and API; `/sync` is the Hocuspocus sync server. */
export async function startServer({ port, dev }: { port: number; dev: boolean }): Promise<RunningServer> {
  const app = next({ dev, dir: import.meta.dirname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const handleUpgrade = app.getUpgradeHandler();
  const sync = serveSync(createSyncServer());
  const stopCleanup = startCleanup();

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/sync") {
      sync.handleUpgrade(req, socket, head);
      return;
    }
    // Everything else (Next's HMR socket in dev) belongs to Next.
    void handleUpgrade(req, socket, head);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  const { port: actual } = server.address() as AddressInfo;

  return {
    url: `http://localhost:${actual}`,
    async close() {
      stopCleanup();
      await sync.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await app.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3400);
  const dev = process.env.NODE_ENV !== "production";
  startServer({ port, dev }).then(({ url }) => console.log(`Rota ready on ${url}`));
}

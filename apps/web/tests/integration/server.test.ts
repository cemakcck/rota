import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer, type RunningServer } from "../../server";
import { closeProviders, liveServerTests, watchForSecondYjs } from "./liveServer";

// Dev mode: production.test.ts runs the live-server checks against a production build.
describe("startServer (dev)", () => {
  let server: RunningServer;
  let yjs: ReturnType<typeof watchForSecondYjs>;

  beforeAll(async () => {
    yjs = watchForSecondYjs();
    server = await startServer({ port: 0, dev: true });
  }, 120_000);

  afterEach(closeProviders);

  afterAll(async () => {
    yjs?.restore();
    await server?.close();
  });

  it("one port serves pages and health", async () => {
    const health = await fetch(`${server.url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    const page = await fetch(`${server.url}/en`);
    expect(page.status).toBe(200);
  }, 120_000);

  liveServerTests(() => ({ server, yjs }));

  it("Next's HMR socket still connects after pages have been served", async () => {
    expect((await fetch(`${server.url}/en`)).status).toBe(200);
    const ws = new WebSocket(`${server.url.replace("http", "ws")}/_next/hmr`, { headers: { origin: server.url } });
    try {
      const outcome = await new Promise<string>((resolve) => {
        ws.once("open", () => resolve("open"));
        ws.once("error", (err) => resolve(`error: ${err.message}`));
        ws.once("close", (code) => resolve(`closed ${code}`));
      });
      expect(outcome).toBe("open");
    } finally {
      ws.terminate();
    }
  }, 30_000);
});

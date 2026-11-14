import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../../server";

// Dev mode: a production build would add a minute to every test run, and the one-port wiring under test
// (HTTP routing through the custom server) is the same in both modes.
describe("startServer", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer({ port: 0, dev: true });
  }, 120_000);
  afterAll(async () => {
    await server?.close();
  });

  it("one port serves pages and health", async () => {
    const health = await fetch(`${server.url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    const page = await fetch(`${server.url}/en`);
    expect(page.status).toBe(200);
  }, 120_000);
});

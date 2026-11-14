import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../../server";
import { closeProviders, liveServerTests, watchForSecondYjs } from "./liveServer";

// The same live-server checks against a production build: which packages Next bundles into route
// handlers differs between `next dev` and `next build`, and a second Yjs copy breaks live edits.
// The build takes well under a minute.
describe("startServer (production build)", () => {
  let server: RunningServer;
  let yjs: ReturnType<typeof watchForSecondYjs>;

  beforeAll(async () => {
    await promisify(execFile)("npx", ["next", "build"], {
      cwd: `${import.meta.dirname}/../..`,
      env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
      maxBuffer: 64 * 1024 * 1024,
    });
    yjs = watchForSecondYjs();
    server = await startServer({ port: 0, dev: false });
  }, 300_000);

  afterEach(closeProviders);

  afterAll(async () => {
    yjs?.restore();
    await server?.close();
  });

  liveServerTests(() => ({ server, yjs }));

  it("serves MapLibre's worker from this origin", async () => {
    const res = await fetch(`${server.url}/maplibre-gl-worker.mjs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect((await res.text()).length).toBeGreaterThan(1000);
  });
});

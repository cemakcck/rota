import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../../server";
import { closeProviders, liveServerTests, watchForSecondYjs } from "./liveServer";

// The same live-server checks against a production build: which packages Next bundles into route
// handlers differs between `next dev` and `next build`, and a second Yjs copy breaks live edits.
// The build takes well under a minute. CI builds once up front and sets ROTA_REUSE_BUILD=1 so this suite
// and the e2e suite run against that build instead of each building again.
describe("startServer (production build)", () => {
  let server: RunningServer;
  let yjs: ReturnType<typeof watchForSecondYjs>;

  beforeAll(async () => {
    const reuse = process.env.ROTA_REUSE_BUILD === "1" && existsSync(`${import.meta.dirname}/../../.next/BUILD_ID`);
    if (!reuse) await promisify(execFile)("npx", ["next", "build"], {
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

  it("serves the service worker and the web manifest, and pages link them", async () => {
    const sw = await fetch(`${server.url}/sw.js`);
    expect(sw.status).toBe(200);
    expect(sw.headers.get("content-type")).toMatch(/javascript/);
    // Named for this build, so the next build's worker deletes its caches.
    const buildId = (await readFile(`${import.meta.dirname}/../../.next/BUILD_ID`, "utf8")).trim();
    expect(await sw.text()).toContain(`const VERSION = "${buildId}";`);

    const manifest = await fetch(`${server.url}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toMatch(/^application\/manifest\+json/);
    expect(await manifest.json()).toMatchObject({ name: "Rota", start_url: "/en/trips", display: "standalone" });

    const offline = await fetch(`${server.url}/offline.html`);
    expect(offline.status).toBe(200);

    const html = await (await fetch(`${server.url}/en`)).text();
    expect(html).toMatch(/<link rel="manifest" href="\/manifest.webmanifest"/);
    // The friend handoff runs before the app renders anything: nothing renders (and so nothing is
    // requested) without the page's flight data, which inline scripts after it deliver. Next puts its
    // async chunk scripts ahead of it in <head>; they only define modules.
    const handoff = html.indexOf("#rota-friend=");
    expect(handoff).toBeGreaterThan(-1);
    expect(handoff).toBeLessThan(html.indexOf("self.__next_f"));
  });
});

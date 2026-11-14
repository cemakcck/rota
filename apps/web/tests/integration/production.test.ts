import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe } from "vitest";
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
});

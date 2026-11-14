import { readFile } from "node:fs/promises";
import { findUp } from "@/server/files";

/** The id of the production build being served (`.next/BUILD_ID`), or "dev" without one. */
async function buildId(): Promise<string> {
  try {
    return (await readFile(await findUp(".next/BUILD_ID", import.meta.url), "utf8")).trim() || "dev";
  } catch {
    return "dev";
  }
}

/**
 * The service worker (src/sw/sw.js) with this build's id filled in: each build names its own caches,
 * and its worker deletes the previous build's when it activates. The browser checks it for changes on
 * every navigation, so it is never cached.
 */
export async function GET() {
  const source = await readFile(await findUp("src/sw/sw.js", import.meta.url), "utf8");
  return new Response(source.replaceAll("__BUILD_ID__", await buildId()), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
  });
}

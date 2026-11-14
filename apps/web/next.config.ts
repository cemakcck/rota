import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Shared trip logic ships as TypeScript source; Next compiles it.
  transpilePackages: ["@rota/trip"],
  // One Yjs per process: route handlers edit the live documents of the sync server that server.ts runs
  // (trips/live.ts), and Yjs types from one copy break the constructor checks of another. Left to Next,
  // yjs would be bundled into the route handlers as a second copy.
  serverExternalPackages: ["yjs"],
  devIndicators: false,
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);

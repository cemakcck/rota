import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Shared trip logic ships as TypeScript source; Next compiles it.
  transpilePackages: ["@rota/trip"],
  devIndicators: false,
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);

# One container, one port: the custom server (apps/web/server.ts) serves the Next.js app and the
# Hocuspocus sync socket at /sync. Railway sets PORT.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/trip/package.json packages/trip/
# Only the test suites use a browser.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NEXT_TELEMETRY_DISABLED=1
RUN npm ci
COPY . .
# next build, then esbuild bundles server.ts and scripts/migrate.ts to apps/web/dist so the image runs
# plain Node. Dev dependencies, .next/cache (only for rebuilds) and the tests go after.
RUN npm run build -w @rota/web && npm prune --omit=dev && rm -rf apps/web/.next/cache apps/web/tests

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3400
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/trip ./packages/trip
# The built app plus what it reads at runtime: .next (incl. BUILD_ID, which names the service worker's
# caches), dist/, drizzle/ migrations, public/, next.config.ts and src/ (src/sw/sw.js is served by
# /sw.js). MapLibre's worker is read from node_modules/maplibre-gl, yjs stays in node_modules (one copy).
COPY --from=build /app/apps/web ./apps/web
WORKDIR /app/apps/web
USER node
EXPOSE 3400
# Migrations first (they retry while Neon wakes up), then the server.
CMD ["sh", "-c", "node dist/migrate.mjs && exec node dist/server.mjs"]

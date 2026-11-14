import { build, type Plugin } from "esbuild";

/**
 * Bundles the custom server and the migration script to dist/ for the container, so it runs on plain
 * Node without tsx. Our own code (`@/…`, relative imports and the `@rota/trip` workspace, which ships
 * TypeScript source) is bundled; every npm package stays an import of node_modules. That keeps one
 * copy of yjs: the route handlers Next built load the same node_modules/yjs as the sync server.
 */
const externalPackages: Plugin = {
  name: "external-packages",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@/") || args.path.startsWith("@rota/")) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: { server: "server.ts", migrate: "scripts/migrate.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  plugins: [externalPackages],
  logLevel: "info",
});

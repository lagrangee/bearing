import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const reactDevTooling = (): Plugin => ({
  name: "bearing-react-dev-tooling",
  apply: "serve",
  transformIndexHtml: {
    order: "pre",
    handler: () => [
      {
        tag: "script",
        attrs: { type: "module", src: "/src/portal-ui/dev-tools.ts" },
        injectTo: "head",
      },
    ],
  },
});

// biome-ignore lint/style/noDefaultExport: Vite discovers configuration through this export.
export default defineConfig({
  plugins: [react(), reactDevTooling()],
  server: {
    host: "127.0.0.1",
    port: 5178,
    proxy: {
      "/api": "http://127.0.0.1:4178",
      "/healthz": "http://127.0.0.1:4178",
    },
  },
  build: {
    outDir: "dist/portal",
    emptyOutDir: true,
    manifest: false,
    sourcemap: false,
  },
});

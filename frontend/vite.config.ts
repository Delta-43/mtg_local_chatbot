import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The backend has no meaningful offline mode -- it fundamentally needs live
// calls to rules-mcp/scryfall-mcp/searxng (see TODO.md). The service worker
// only caches the installable app shell (static assets); /chat and
// /chat/stream are explicitly excluded from any caching strategy.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "MTG Judge",
        short_name: "MTG Judge",
        description: "An AI Magic: The Gathering rules judge",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        icons: [
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml" },
          {
            src: "icons/icon-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Never let the SW intercept chat calls -- they're cross-origin to
        // VITE_API_BASE_URL and must always hit the network live.
        runtimeCaching: [
          {
            urlPattern: /\/chat(\/stream)?$/,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});

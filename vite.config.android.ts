// Static SPA build used for the offline-first Capacitor Android bundle.
//
// This mirrors vite.config.ts but disables the Nitro/Cloudflare packaging and
// enables TanStack Start's native prerender, which SSR-renders every route and
// writes <route>/index.html shells into the client output directory
// (dist/client). Those static shells are what the Android WebView loads.
//
// Invoke with: npm run build:static
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Produce a plain static client build + SSR server for prerendering —
  // no Nitro/Cloudflare deploy bundle.
  nitro: false,
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
    // SSR-render each route once at build time and write the HTML into
    // dist/client (client env build outDir). The WebView then boots the
    // React app on top of these shells; app data loads client-side via
    // server functions / Supabase over HTTP when network is available.
    prerender: {
      enabled: true,
      // Don't let one failing route abort the whole build; a skipped route
      // simply falls back to the client-rendered shell.
      failOnError: false,
    },
    pages: [
      { path: "/" },
      { path: "/auth" },
      { path: "/goals" },
      { path: "/habits" },
      { path: "/history" },
      { path: "/reset-password" },
      { path: "/routines" },
      { path: "/subjects" },
      { path: "/today" },
    ],
  },
});
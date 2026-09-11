// Momentum service worker: offline shell + hashed-asset caching.
// Conservative by design: same-origin GETs only. Navigations are network-first
// with a cached-shell fallback; hashed /assets are cache-first (immutable).
// Supabase REST and TanStack server functions always hit the network.
const CACHE = "momentum-v1";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/pwa-192.png",
  "/pwa-maskable-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Supabase and TanStack server functions must always hit the network.
  if (url.pathname.startsWith("/_serverFn") || url.pathname.includes("supabase")) return;

  // Hashed, immutable build assets: cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Navigations: network-first with cached-shell fallback (offline support).
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || (await cache.match("/")) || Response.error();
      }
    })());
  }
  // All other same-origin GETs pass through untouched.
});

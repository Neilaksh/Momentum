import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";

/**
 * Owns the PWA lifecycle: service-worker registration, the "new version ready"
 * prompt and the offline indicator. Mounted once from the root route.
 *
 * Nothing here may touch `navigator`/`location` during render — the root route
 * is server-rendered, so all browser access lives inside effects (which also
 * keeps the first client render byte-identical to the server output).
 */
export function PwaStatus() {
  const [offline, setOffline] = useState(false);

  // Offline indicator. Starts `false` so the banner can never flash during SSR
  // or before hydration; the effect syncs it to the real value immediately.
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Service worker registration. Skipped inside the Capacitor Android WebView
  // (https://localhost, no port) and on http dev servers, so bundled/dev output
  // is never intercepted.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const isCapacitorWebView = location.hostname === "localhost" && location.port === "";
    if (location.protocol !== "https:" || isCapacitorWebView) return;

    let prompted = false;
    const promptReload = () => {
      if (prompted) return;
      // Never prompt on a first-ever install: without a controller there is no
      // previous version to update away from, so it would be a false positive.
      if (!navigator.serviceWorker.controller) return;
      prompted = true;
      toast("Update available", {
        description: "A new version of Momentum is ready.",
        duration: Number.POSITIVE_INFINITY,
        action: { label: "Reload", onClick: () => window.location.reload() },
      });
    };

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          // A worker that finished installing while this tab was backgrounded is
          // already parked in `waiting` — there is no `updatefound` left to fire.
          if (registration.waiting) promptReload();

          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed") promptReload();
            });
          });
        })
        .catch((err) => {
          console.warn("[pwa] service worker registration failed", err);
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-lg">
        <WifiOff className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-muted-foreground">Offline — showing your last synced data</span>
      </div>
    </div>
  );
}

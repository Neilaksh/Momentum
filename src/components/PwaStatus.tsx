import { useEffect, useState } from "react";
import { Download, WifiOff } from "lucide-react";
import { toast } from "sonner";

/**
 * `beforeinstallprompt` is not part of the DOM lib yet, so the deferred event is
 * described structurally here.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Remembers that the install offer was actioned so it never nags twice. */
const INSTALL_KEY = "momentum:install-prompt";

/**
 * Owns the PWA lifecycle: service-worker registration, the "new version ready"
 * prompt, the install prompt and the offline indicator. Mounted once from the
 * root route.
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
        id: "pwa-update",
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

  // Install offer. Chrome fires `beforeinstallprompt` only once the app is
  // actually installable (manifest + service worker + engagement), so the toast
  // is never shown to browsers that cannot install. The choice is remembered in
  // localStorage so the prompt appears at most once.
  useEffect(() => {
    const remember = () => {
      try {
        localStorage.setItem(INSTALL_KEY, "1");
      } catch {
        // Storage can be unavailable (private mode); nagging at most once per
        // session is an acceptable fallback.
      }
    };

    const onBeforeInstall = (event: Event) => {
      // Without preventDefault Chrome shows its own mini-infobar instead of
      // letting us surface the install action in-app.
      event.preventDefault();
      try {
        if (localStorage.getItem(INSTALL_KEY) === "1") return;
      } catch {
        /* ignore */
      }
      const installEvent = event as BeforeInstallPromptEvent;
      toast("Install Momentum", {
        id: "pwa-install",
        icon: <Download className="h-4 w-4" />,
        description: "Add it to your home screen for offline access.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Install",
          onClick: () => {
            // `prompt()` may only be called once per event, so the toast is
            // dismissed either way. A dismissal is remembered too, otherwise the
            // offer would reappear on the next visit even though the user
            // declined the native install sheet.
            void installEvent.prompt().then(async () => {
              const { outcome } = await installEvent.userChoice;
              if (outcome === "dismissed") remember();
              toast.dismiss("pwa-install");
            });
          },
        },
        cancel: { label: "Not now", onClick: remember },
        onDismiss: remember,
      });
    };

    const onInstalled = () => {
      toast.dismiss("pwa-install");
      remember();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
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

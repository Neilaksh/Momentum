import { useEffect, useState } from "react";
import { Download, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { usePlatform } from "@/hooks/use-platform";
import { InstallGuideDialog } from "@/components/InstallGuideDialog";

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
 * prompt, the install prompt, the install guide dialog, and the offline indicator.
 * Mounted once from the root route.
 */
export function PwaStatus() {
  const [offline, setOffline] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const platform = usePlatform();

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

  // Listen for programmatic open requests (e.g. from AppShell install button)
  useEffect(() => {
    const handleOpen = () => setGuideOpen(true);
    window.addEventListener("momentum:open-install-guide", handleOpen);
    return () => {
      window.removeEventListener("momentum:open-install-guide", handleOpen);
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

          // Periodic check when returning to long-lived tabs (e.g. Firefox Android shortcut tabs)
          let lastCheck = Date.now();
          const checkUpdate = () => {
            const now = Date.now();
            if (now - lastCheck < 30 * 60 * 1000) return;
            lastCheck = now;
            void registration.update().catch(() => {});
          };
          window.addEventListener("focus", checkUpdate);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") checkUpdate();
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

  // Install offer handling.
  // 1. For Chromium browsers: listens to `beforeinstallprompt` and offers native install or guide.
  // 2. For non-Chromium browsers (Firefox Android, iOS Safari): offers a guide toast if not dismissed.
  useEffect(() => {
    const remember = () => {
      try {
        localStorage.setItem(INSTALL_KEY, "1");
      } catch {
        // Storage can be unavailable in private mode
      }
    };

    const isDismissed = () => {
      try {
        return localStorage.getItem(INSTALL_KEY) === "1";
      } catch {
        return false;
      }
    };

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      if (isDismissed()) return;

      const installEvent = event as BeforeInstallPromptEvent;
      setDeferredPrompt(installEvent);

      toast("Install Momentum", {
        id: "pwa-install",
        icon: <Download className="h-4 w-4" />,
        description: "Add it to your home screen for offline access.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Install",
          onClick: () => {
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
      setDeferredPrompt(null);
      remember();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // For non-Chromium browsers that never fire beforeinstallprompt (Firefox Android, iOS Safari):
    // Show manual install guide offer after a short settling delay if not already installed.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (
      platform.isClient &&
      !platform.isStandalone &&
      !platform.isCapacitor &&
      (platform.isFirefoxAndroid || platform.isIOSSafari) &&
      !isDismissed()
    ) {
      timer = setTimeout(() => {
        if (isDismissed()) return;
        toast("Install Momentum", {
          id: "pwa-install-guide-toast",
          icon: <Download className="h-4 w-4" />,
          description: platform.isFirefoxAndroid
            ? "Add to home screen for instant access in Firefox."
            : "Add to your home screen for full-screen offline access.",
          duration: 15000,
          action: {
            label: "Guide",
            onClick: () => {
              setGuideOpen(true);
              remember();
              toast.dismiss("pwa-install-guide-toast");
            },
          },
          cancel: { label: "Not now", onClick: remember },
          onDismiss: remember,
        });
      }, 4000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, [platform]);

  const handleTriggerNativePrompt = () => {
    if (!deferredPrompt) return;
    void deferredPrompt.prompt().then(async () => {
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "dismissed") {
        try {
          localStorage.setItem(INSTALL_KEY, "1");
        } catch {
          /* ignore */
        }
      }
      toast.dismiss("pwa-install");
    });
  };

  return (
    <>
      <InstallGuideDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        hasPrompt={Boolean(deferredPrompt)}
        onTriggerPrompt={handleTriggerNativePrompt}
      />

      {offline && (
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
      )}
    </>
  );
}

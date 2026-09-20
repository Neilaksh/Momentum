import { useEffect, useState } from "react";

export interface PlatformInfo {
  isClient: boolean;
  isStandalone: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  isFirefox: boolean;
  isFirefoxAndroid: boolean;
  isFirefoxDesktop: boolean;
  isSafari: boolean;
  isIOSSafari: boolean;
  isChromium: boolean;
  isCapacitor: boolean;
}

const defaultPlatform: PlatformInfo = {
  isClient: false,
  isStandalone: false,
  isAndroid: false,
  isIOS: false,
  isFirefox: false,
  isFirefoxAndroid: false,
  isFirefoxDesktop: false,
  isSafari: false,
  isIOSSafari: false,
  isChromium: false,
  isCapacitor: false,
};

export function usePlatform(): PlatformInfo {
  const [platform, setPlatform] = useState<PlatformInfo>(defaultPlatform);

  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;

    const ua = navigator.userAgent.toLowerCase();
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    const isCapacitor =
      (
        window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
      )?.Capacitor?.isNativePlatform?.() ||
      (window.location.hostname === "localhost" && window.location.port === "");

    const isAndroid = /android/i.test(ua);
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isFirefox = /firefox|fxios/i.test(ua);
    const isFirefoxAndroid = isFirefox && isAndroid;
    const isFirefoxDesktop = isFirefox && !isAndroid && !isIOS;
    const isChromium =
      Boolean((window as unknown as { chrome?: unknown }).chrome) ||
      (/chrome|crios/i.test(ua) && !/edg|opr/i.test(ua));
    const isSafari = /safari/i.test(ua) && !/chrome|crios|firefox|fxios|edg|opr/i.test(ua);
    const isIOSSafari = isIOS && isSafari;

    // Apply data-mode attribute on <html> for CSS selectors
    document.documentElement.dataset["mode"] = isStandalone ? "standalone" : "tab";

    setPlatform({
      isClient: true,
      isStandalone,
      isAndroid,
      isIOS,
      isFirefox,
      isFirefoxAndroid,
      isFirefoxDesktop,
      isSafari,
      isIOSSafari,
      isChromium,
      isCapacitor: Boolean(isCapacitor),
    });

    const mq = window.matchMedia("(display-mode: standalone)");
    const handleModeChange = (e: MediaQueryListEvent) => {
      document.documentElement.dataset["mode"] = e.matches ? "standalone" : "tab";
      setPlatform((prev) => ({ ...prev, isStandalone: e.matches }));
    };

    mq.addEventListener("change", handleModeChange);
    return () => {
      mq.removeEventListener("change", handleModeChange);
    };
  }, []);

  return platform;
}

export function openInstallGuide() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("momentum:open-install-guide"));
  }
}

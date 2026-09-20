import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePlatform } from "@/hooks/use-platform";
import {
  Download,
  Share2,
  MoreVertical,
  Smartphone,
  Monitor,
  CheckCircle2,
  Bookmark,
} from "lucide-react";

interface InstallGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTriggerPrompt?: () => void;
  hasPrompt?: boolean;
}

type GuideTab = "firefox-android" | "ios" | "chrome" | "desktop";

export function InstallGuideDialog({
  open,
  onOpenChange,
  onTriggerPrompt,
  hasPrompt,
}: InstallGuideDialogProps) {
  const platform = usePlatform();
  const [activeTab, setActiveTab] = useState<GuideTab>("firefox-android");

  useEffect(() => {
    if (!platform.isClient) return;
    if (platform.isFirefoxAndroid) {
      setActiveTab("firefox-android");
    } else if (platform.isIOS || platform.isIOSSafari) {
      setActiveTab("ios");
    } else if (platform.isAndroid || platform.isChromium) {
      setActiveTab("chrome");
    } else {
      setActiveTab("desktop");
    }
  }, [platform]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto p-5 sm:p-6">
        <DialogHeader className="space-y-1.5 text-left">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">Install Momentum</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Fast offline access & home screen presence
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Browser Selector Tabs */}
        <div className="flex rounded-lg bg-secondary/60 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("firefox-android")}
            className={`flex-1 rounded-md py-1.5 text-center transition-colors ${
              activeTab === "firefox-android"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Firefox Android
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ios")}
            className={`flex-1 rounded-md py-1.5 text-center transition-colors ${
              activeTab === "ios"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            iOS Safari
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chrome")}
            className={`flex-1 rounded-md py-1.5 text-center transition-colors ${
              activeTab === "chrome"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Chrome / Edge
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("desktop")}
            className={`flex-1 rounded-md py-1.5 text-center transition-colors ${
              activeTab === "desktop"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Desktop
          </button>
        </div>

        {/* Guide Content */}
        <div className="space-y-4 pt-1 text-sm">
          {activeTab === "firefox-android" && (
            <div className="space-y-3.5">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Firefox Android note:</span> Firefox
                creates a direct home screen shortcut that launches Momentum in a clean tab with
                offline sync and theme bar styling.
              </div>

              <ol className="space-y-3">
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-foreground">
                    1
                  </span>
                  <div>
                    <p className="font-medium text-foreground">Open Firefox Menu</p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      Tap the three vertical dots <MoreVertical className="inline h-3.5 w-3.5" /> in
                      Firefox's address or navigation bar.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-foreground">
                    2
                  </span>
                  <div>
                    <p className="font-medium text-foreground">
                      Tap &ldquo;Add to home screen&rdquo;
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Scroll through the menu options and tap &ldquo;Add to home screen&rdquo;.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-foreground">
                    3
                  </span>
                  <div>
                    <p className="font-medium text-foreground">Confirm &ldquo;Add&rdquo;</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Tap &ldquo;Add&rdquo; on the prompt. Momentum's app icon will appear on your
                      phone's home screen.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {activeTab === "ios" && (
            <div className="space-y-3.5">
              <ol className="space-y-3">
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-foreground">
                    1
                  </span>
                  <div>
                    <p className="font-medium text-foreground">Tap the Share button</p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      In Safari, tap the <Share2 className="inline h-3.5 w-3.5 text-primary" /> icon
                      at the bottom toolbar.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-foreground">
                    2
                  </span>
                  <div>
                    <p className="font-medium text-foreground">
                      Select &ldquo;Add to Home Screen&rdquo;
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Scroll down in the share sheet and tap &ldquo;Add to Home Screen&rdquo;.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-foreground">
                    3
                  </span>
                  <div>
                    <p className="font-medium text-foreground">Tap &ldquo;Add&rdquo; to complete</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Tap &ldquo;Add&rdquo; in the upper-right corner. It will launch as a
                      standalone fullscreen app.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {activeTab === "chrome" && (
            <div className="space-y-3.5">
              {hasPrompt && onTriggerPrompt ? (
                <div className="rounded-lg border border-border bg-card p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-3">
                    One-tap native install is ready on your browser:
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onTriggerPrompt();
                      onOpenChange(false);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
                  >
                    <Download className="h-4 w-4" /> Install Momentum Now
                  </button>
                </div>
              ) : (
                <ol className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-foreground">
                      1
                    </span>
                    <div>
                      <p className="font-medium text-foreground">Look for Install icon</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        In the address bar or tap browser menu (⋮) in the top right.
                      </p>
                    </div>
                  </li>

                  <li className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-foreground">
                      2
                    </span>
                    <div>
                      <p className="font-medium text-foreground">
                        Choose &ldquo;Install Momentum&rdquo;
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Confirm the prompt to install Momentum as a standalone app on your device.
                      </p>
                    </div>
                  </li>
                </ol>
              )}
            </div>
          )}

          {activeTab === "desktop" && (
            <div className="space-y-3.5">
              <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                <Bookmark className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-medium text-foreground">Bookmark Momentum</p>
                  <p className="text-muted-foreground mt-0.5">
                    Momentum runs seamlessly in your desktop browser. Press{" "}
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                      Ctrl+D
                    </kbd>{" "}
                    (or{" "}
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                      ⌘+D
                    </kbd>{" "}
                    on Mac) to bookmark it.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                <Monitor className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-medium text-foreground">Chrome / Edge App Window</p>
                  <p className="text-muted-foreground mt-0.5">
                    Click the install icon in your address bar to launch Momentum in its own
                    borderless window.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex justify-end border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg bg-secondary px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80"
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

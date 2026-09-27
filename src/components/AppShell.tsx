import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  CheckSquare,
  Clock,
  Download,
  Flame,
  History,
  LogOut,
  MoreHorizontal,
  Target,
  Timer,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { levelProgress, type Profile } from "@/lib/tracker-shared";
import { usePlatform, openInstallGuide } from "@/hooks/use-platform";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const NAV = [
  { to: "/", label: "Tasks" },
  { to: "/routines", label: "Routines" },
  { to: "/habits", label: "Habits" },
  { to: "/goals", label: "Goals" },
  { to: "/subjects", label: "Subjects" },
  { to: "/study", label: "Study" },
  { to: "/history", label: "History" },
] as const;

const MOBILE_PRIMARY_TABS = [
  { to: "/", label: "Tasks", icon: CheckSquare },
  { to: "/routines", label: "Routines", icon: Clock },
  { to: "/habits", label: "Habits", icon: Flame },
  { to: "/goals", label: "Goals", icon: Target },
] as const;

export function AppShell({ profile, children }: { profile?: Profile | null; children: ReactNode }) {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const lp = levelProgress(profile?.total_xp ?? 0);
  const platform = usePlatform();
  const [moreOpen, setMoreOpen] = useState(false);
  const contentMaxWidth =
    platform.isStandalone || platform.isCapacitor ? "max-w-7xl" : "max-w-[1600px]";

  const isMoreActive =
    currentPath === "/subjects" || currentPath === "/study" || currentPath === "/history";

  return (
    <div className="min-h-dvh">
      <style>{`#lovable-badge { display: none !important; }`}</style>
      {/* `env(safe-area-inset-top)` reserves room for the notch/status bar in the
          installed PWA (we opt into `viewport-fit=cover`). It resolves to 0 in a
          normal browser tab, so desktop layout is untouched. */}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div
          className={`mx-auto flex ${contentMaxWidth} items-center justify-between gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 sm:py-3`}
        >
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <span className="text-sm font-semibold tracking-wider uppercase">Momentum</span>
            </Link>

            {/* Desktop Navigation (md+) */}
            <nav className="hidden md:flex items-center gap-1.5">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.to === "/" }}
                  activeProps={{
                    className: "bg-secondary text-foreground",
                    "aria-current": "page" as const,
                  }}
                  inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
                  className="rounded-full px-3 py-1.5 text-xs sm:px-3 sm:py-1.5 sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 min-h-[36px] flex items-center"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-4">
            {platform.isClient && !platform.isStandalone && !platform.isCapacitor && (
              <button
                type="button"
                aria-label="Install app"
                title="Install app"
                onClick={openInstallGuide}
                className="flex items-center gap-1.5 rounded-full border border-border/80 bg-secondary/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-95"
              >
                <Download className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">Install</span>
              </button>
            )}

            {profile && (
              <div className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Flame className="h-4 w-4 text-primary" />
                <span className="num font-semibold">{profile?.current_streak ?? 0}</span>
                <span className="text-muted-foreground hidden xs:inline">day streak</span>
              </div>
            )}
            {profile && (
              <div className="hidden items-center gap-2 sm:flex">
                <Zap className="h-4 w-4 text-primary" />
                <div className="w-28">
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>Lv {lp.level}</span>
                    <span className="num">{profile?.total_xp ?? 0} XP</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${lp.pct}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
            <button
              aria-label="Sign out"
              className="hidden md:flex rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              onClick={async () => {
                await supabase.auth.signOut();
                void navigate({ to: "/auth" });
              }}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content with safe area and bottom nav padding */}
      <main
        className={`mx-auto ${contentMaxWidth} w-full min-w-0 px-4 py-5 pb-[calc(4.25rem+max(1.25rem,env(safe-area-inset-bottom)))] sm:px-6 sm:py-8 md:pb-[max(2rem,env(safe-area-inset-bottom))] overflow-x-clip`}
      >
        {children}
      </main>

      {/* Mobile Bottom Navigation Bar (md:hidden) */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-border/80 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {MOBILE_PRIMARY_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.to === "/" ? currentPath === "/" : currentPath.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className={`text-[11px] mt-1 font-medium ${isActive ? "font-semibold" : ""}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}

        {/* More Tab Trigger */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-label="More navigation options and profile"
          className={`flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
            isMoreActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className={`text-[11px] mt-1 font-medium ${isMoreActive ? "font-semibold" : ""}`}>
            More
          </span>
        </button>
      </nav>

      {/* Mobile "More" Sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4"
        >
          <SheetHeader className="text-left pb-3 border-b border-border/60">
            <SheetTitle className="text-base font-bold">Momentum Menu</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Additional views, stats & account options
            </SheetDescription>
          </SheetHeader>

          {/* Level / XP Progress Card */}
          {profile && (
            <div className="mt-4 rounded-xl border border-border/80 bg-secondary/40 p-3">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5 text-primary">
                  <Zap className="h-4 w-4" /> Level {lp.level}
                </span>
                <span className="num font-normal text-muted-foreground">{profile.total_xp} XP</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${lp.pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground text-right">
                {lp.pct}% to Level {lp.level + 1}
              </p>
            </div>
          )}

          {/* Secondary Views Links */}
          <div className="mt-4 space-y-1">
            <Link
              to="/study"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-secondary active:bg-secondary/80"
            >
              <Timer className="h-4 w-4 text-amber-400" />
              <span>Study Timer</span>
            </Link>

            <Link
              to="/subjects"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-secondary active:bg-secondary/80"
            >
              <BookOpen className="h-4 w-4 text-blue-400" />
              <span>Subjects</span>
            </Link>

            <Link
              to="/history"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-secondary active:bg-secondary/80"
            >
              <History className="h-4 w-4 text-purple-400" />
              <span>History & Analytics</span>
            </Link>

            {platform.isClient && !platform.isStandalone && !platform.isCapacitor && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  openInstallGuide();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-secondary text-left"
              >
                <Download className="h-4 w-4 text-emerald-400" />
                <span>Install Momentum App</span>
              </button>
            )}
          </div>

          {/* Sign Out Button */}
          <div className="mt-4 border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={async () => {
                setMoreOpen(false);
                await supabase.auth.signOut();
                void navigate({ to: "/auth" });
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

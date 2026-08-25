import { Link, useNavigate } from "@tanstack/react-router";
import { Flame, LogOut, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { levelProgress, type Profile } from "@/lib/tracker-shared";

const NAV = [
  { to: "/", label: "Week" },
  { to: "/routine", label: "Routine" },
  { to: "/goals", label: "Goals" },
  { to: "/history", label: "History" },
] as const;

export function AppShell({ profile, children }: { profile?: Profile | null; children: ReactNode }) {
  const navigate = useNavigate();
  const lp = levelProgress(profile?.total_xp ?? 0);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="text-sm font-semibold tracking-[0.2em] uppercase">Momentum</span>
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                activeProps={{ className: "bg-secondary text-foreground" }}
                inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
                className="rounded-full px-3 py-1.5 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            {profile && (
            <div className="flex items-center gap-1.5 text-sm">
              <Flame className="h-4 w-4 text-primary" />
              <span className="num font-semibold">{profile?.current_streak ?? 0}</span>
              <span className="text-muted-foreground">day streak</span>
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
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

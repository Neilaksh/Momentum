import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Flame, Trophy, Zap } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { ProgressRing } from "@/components/ProgressRing";
import { getHistory } from "@/lib/tracker.functions";
import { formatDayDate, levelProgress, type Profile } from "@/lib/tracker-shared";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History & Stats — Momentum" },
      {
        name: "description",
        content:
          "Review past weeks, completion rates over time, your longest streak and the XP level you've reached.",
      },
      { property: "og:title", content: "History & Stats — Momentum" },
      {
        property: "og:description",
        content: "Past weeks, completion trends, streaks and XP levels at a glance.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <HistoryPage />
    </RequireAuth>
  ),
});

type HistoryResponse = {
  profile: Profile | null;
  weeks: { weekStart: string; total: number; done: number }[];
};

function HistoryPage() {
  const fetchHistory = useServerFn(getHistory);
  const { data, isLoading } = useQuery({
    queryKey: ["history"],
    queryFn: () => fetchHistory({ data: undefined }) as Promise<HistoryResponse>,
  });

  const weeks = data?.weeks ?? [];
  const profile = data?.profile ?? null;
  const lp = levelProgress(profile?.total_xp ?? 0);

  const chart = weeks.map((w) => ({
    week: formatDayDate(w.weekStart),
    pct: w.total ? Math.round((w.done / w.total) * 100) : 0,
  }));

  return (
    <AppShell profile={profile}>
      <h1 className="text-3xl font-semibold tracking-tight">History</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every week you've tracked so far.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={<Zap className="h-4 w-4" />} label="Level" value={`${lp.level}`} sub={`${profile?.total_xp ?? 0} XP total`} />
        <StatCard
          icon={<Flame className="h-4 w-4" />}
          label="Current streak"
          value={`${profile?.current_streak ?? 0}`}
          sub="days in a row"
        />
        <StatCard
          icon={<Trophy className="h-4 w-4" />}
          label="Longest streak"
          value={`${profile?.best_streak ?? 0}`}
          sub="personal best"
        />
      </div>

      {chart.length > 1 && (
        <section className="mt-6 h-56 rounded-2xl border border-border bg-card p-5">
          <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground">Completion rate</p>
          <div className="mt-3 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="pct" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : weeks.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nothing tracked yet — start ticking tasks on the week board.
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {weeks.map((w) => (
            <article
              key={w.weekStart}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5"
            >
              <ProgressRing value={w.total ? (w.done / w.total) * 100 : 0} size={72} stroke={8} />
              <div className="min-w-0">
                <p className="num text-sm font-semibold">Week of {formatDayDate(w.weekStart)}</p>
                <p className="num text-xs text-muted-foreground">
                  {w.done} / {w.total} tasks
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground">{label}</p>
      </div>
      <p className="num mt-2 text-3xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

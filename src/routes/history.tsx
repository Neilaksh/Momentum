import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CalendarRange, ChevronRight, Flame, RefreshCw, Trash2, Trophy, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { WeeklyReviewDialog } from "@/components/WeeklyReviewDialog";
import { Button } from "@/components/ui/button";
import { getHistory, resetTrackerData } from "@/lib/tracker.functions";
import { getSubjectBreakdown } from "@/lib/subjects.functions";
import { subjectColorHex, type SubjectBreakdownEntry } from "@/lib/subjects-shared";
import { listWeeklyReviews } from "@/lib/weekly-review.functions";
import { formatDayDate, levelProgress, toISODate, type Profile } from "@/lib/tracker-shared";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History & Stats — Momentum" },
      {
        name: "description",
        content:
          "Review past weeks, completion rates over time, your longest streak, XP levels, and data management.",
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
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const qc = useQueryClient();
  const fetchHistory = useServerFn(getHistory);
  const resetFn = useServerFn(resetTrackerData);

  const { data, isLoading } = useQuery({
    queryKey: ["history"],
    queryFn: () => fetchHistory({ data: undefined }) as Promise<HistoryResponse>,
  });

  const resetMutation = useMutation({
    mutationFn: () => resetFn({ data: undefined }),
    onSuccess: () => {
      void qc.invalidateQueries();
      setShowConfirmReset(false);
      toast.success("All tracker data has been completely deleted.");
    },
    onError: () => toast.error("Failed to delete tracker data. Please try again."),
  });

  const weeks = data?.weeks ?? [];
  const profile = data?.profile ?? null;
  const lp = levelProgress(profile?.total_xp ?? 0);

  const chart = weeks.map((w) => ({
    week: formatDayDate(w.weekStart),
    pct: w.total ? Math.round((w.done / w.total) * 100) : 0,
  }));

  // Completed tasks by subject — last 30 days (no time-range picker exists on this page,
  // so the breakdown uses a fixed 30-day window).
  const fetchBreakdown = useServerFn(getSubjectBreakdown);
  const breakdownFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return toISODate(d);
  }, []);

  const { data: breakdownData } = useQuery({
    queryKey: ["subject-breakdown", breakdownFrom],
    queryFn: () =>
      fetchBreakdown({ data: { fromDate: breakdownFrom } }) as Promise<{
        entries: SubjectBreakdownEntry[];
      }>,
  });
  const subjectEntries = breakdownData?.entries ?? [];
  const subjectChartRows = useMemo(
    () =>
      subjectEntries.map((e) => ({
        name: e.name,
        count: e.count,
        color: subjectColorHex(e.color),
      })),
    [subjectEntries],
  );
  const totalBreakdownCompletions = subjectEntries.reduce((sum, e) => sum + e.count, 0);

  // Past weekly reviews (newest first) for browsing from the History page.
  const fetchReviewList = useServerFn(listWeeklyReviews);
  const [reviewWeek, setReviewWeek] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { data: reviewListData } = useQuery({
    queryKey: ["weekly-reviews"],
    queryFn: () => fetchReviewList({ data: undefined }) as Promise<{ weekStarts: string[] }>,
  });
  const reviewWeeks = reviewListData?.weekStarts ?? [];
  const openReview = (week: string) => {
    setReviewWeek(week);
    setReviewOpen(true);
  };

  return (
    <AppShell profile={profile}>
      <h1 className="text-3xl font-semibold tracking-tight">History & Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every week you've tracked so far and tracker settings.</p>

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

      {chart.length > 1 ? (
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
      ) : chart.length === 1 ? (
        <div className="mt-6 rounded-2xl border border-border/80 bg-card p-4 text-xs text-muted-foreground flex items-center justify-between">
          <span>📊 <strong>Multi-week trend chart:</strong> Keep tracking tasks! The week-over-week completion rate graph will appear once you have at least 2 weeks of activity.</span>
        </div>
      ) : null}

      {/* By Subject — completed tasks grouped by subject, last 30 days */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
            By Subject · Last 30 days
          </p>
        </div>

        {subjectEntries.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-8 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-muted-foreground opacity-40" />
            <p className="mt-2 text-sm font-medium">No subject activity yet</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
              Create subjects on the Subjects page, attach them to your tasks, and once you complete
              some, your per-subject breakdown will appear here.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_280px]">
            {/* Bar chart — subject name vs completed count, colored per subject */}
            <div className="h-56 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={subjectChartRows}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                >
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip
                    cursor={{ fill: "var(--secondary)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(val: any) => [`${val} completed`, "Tasks"]}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {subjectChartRows.map((row, i) => (
                      <Cell key={`${row.name}-${i}`} fill={row.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Ranked list fallback */}
            <ol className="space-y-2 self-start">
              {subjectEntries.map((e, i) => (
                <li
                  key={e.subjectId}
                  className="flex items-center gap-2.5 rounded-lg bg-secondary/40 px-3 py-2"
                >
                  <span className="num w-4 shrink-0 text-[10px] font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: subjectColorHex(e.color) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{e.name}</span>
                  <span className="num text-xs font-semibold text-primary">{e.count}</span>
                </li>
              ))}
              <li className="px-3 pt-1 text-[11px] text-muted-foreground">
                {totalBreakdownCompletions} task{totalBreakdownCompletions !== 1 ? "s" : ""}{" "}
                completed in the last 30 days
              </li>
            </ol>
          </div>
        )}
      </section>

      {/* Weekly Reviews — browse past weeks by Monday date */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-primary" />
          <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground">Weekly Reviews</p>
        </div>
        {reviewWeeks.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            No reviews yet — once you track a week, it will appear here to review at any time.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {reviewWeeks.map((week) => (
              <li key={week}>
                <button
                  onClick={() => openReview(week)}
                  className="flex w-full items-center justify-between rounded-lg bg-secondary/40 px-4 py-3 text-left transition-colors hover:bg-secondary/70"
                >
                  <span className="text-sm font-medium">Week of {formatDayDate(week)}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : weeks.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nothing tracked yet — start ticking tasks on the daily board or habit tracker.
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

      {/* Danger Zone: Reset Tracker Data */}
      <section className="mt-10 rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="text-base font-semibold">Danger Zone: Delete All Tracker Data</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground max-w-xl">
              Permanently delete all your daily tasks, habits, check-in history, goals, and reset your XP, level, and streaks back to zero.
            </p>
          </div>

          {!showConfirmReset ? (
            <Button
              variant="destructive"
              onClick={() => setShowConfirmReset(true)}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              <span>Delete All Tracker Data</span>
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowConfirmReset(false)}
                disabled={resetMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
                className="gap-2"
              >
                {resetMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                <span>Yes, Delete Everything</span>
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Weekly Review dialog — opened from the list above */}
      <WeeklyReviewDialog weekStart={reviewWeek} open={reviewOpen} onOpenChange={setReviewOpen} />
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

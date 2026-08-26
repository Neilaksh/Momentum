import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Flame,
  Plus,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { PieStat } from "@/components/PieStat";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addHabit, deleteHabit, getHabits, toggleHabitDay } from "@/lib/habits.functions";
import type { HabitsData } from "@/lib/habits-shared";
import {
  WEEKDAY_NAMES,
  addDays,
  formatDayDate,
  parseISODate,
  startOfWeek,
  toISODate,
  type WeekData,
} from "@/lib/tracker-shared";
import { getWeek } from "@/lib/tracker.functions";

export const Route = createFileRoute("/habits")({
  head: () => ({
    meta: [
      { title: "Habit Tracker — Weekly & Yearly Progress | Momentum" },
      {
        name: "description",
        content:
          "Track repeating habits with weekly targets, a dedicated weekly completion pie chart and a year-to-date pie chart showing your long-term consistency.",
      },
      { property: "og:title", content: "Habit Tracker — Weekly & Yearly Progress" },
      {
        property: "og:description",
        content: "Repeating habits with weekly and yearly completion pie charts and streaks.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <HabitsPage />
    </RequireAuth>
  ),
});

function HabitsPage() {
  const [weekStart, setWeekStart] = useState(() => toISODate(startOfWeek(new Date())));
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState(7);
  const qc = useQueryClient();
  const todayISO = toISODate(new Date());
  const currentYear = new Date().getFullYear();

  const fetchHabits = useServerFn(getHabits);
  const fetchWeek = useServerFn(getWeek);
  const toggleFn = useServerFn(toggleHabitDay);
  const addFn = useServerFn(addHabit);
  const delFn = useServerFn(deleteHabit);

  const { data, isLoading } = useQuery({
    queryKey: ["habits", weekStart],
    queryFn: () => fetchHabits({ data: { weekStart } }) as Promise<HabitsData>,
  });

  const { data: week } = useQuery({
    queryKey: ["week", weekStart],
    queryFn: () => fetchWeek({ data: { weekStart } }) as Promise<WeekData>,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["habits"] });
    void qc.invalidateQueries({ queryKey: ["history"] });
  };

  const toggle = useMutation({
    mutationFn: (v: { habitId: string; date: string; done: boolean }) => toggleFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["habits", weekStart] });
      const prev = qc.getQueryData<HabitsData>(["habits", weekStart]);
      if (prev) {
        const nextStats = prev.stats.map((s) => {
          if (s.habit.id !== v.habitId) return s;
          const nextDoneDates = v.done
            ? [...s.doneDates, v.date]
            : s.doneDates.filter((d) => d !== v.date);
          const weekDone = prev.dates.filter((d) => nextDoneDates.includes(d)).length;
          const yearDone = v.done ? s.yearDone + 1 : Math.max(0, s.yearDone - 1);
          return {
            ...s,
            doneDates: nextDoneDates,
            weekDone,
            weekPct: Math.round((Math.min(weekDone, s.weekTarget) / s.weekTarget) * 100),
            yearDone,
            yearPct: Math.round((Math.min(yearDone, s.yearTarget) / s.yearTarget) * 100),
          };
        });
        qc.setQueryData<HabitsData>(["habits", weekStart], {
          ...prev,
          stats: nextStats,
        });
      }
      return { prev };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["habits", weekStart], ctx.prev);
      toast.error("Couldn't save habit update — try again.");
    },
    onSettled: invalidate,
  });

  const create = useMutation({
    mutationFn: (v: { title: string; targetPerWeek: number }) => addFn({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("New habit added!");
    },
    onError: () => toast.error("Couldn't add that habit."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.info("Habit removed");
    },
  });

  const stats = data?.stats ?? [];
  const dates = data?.dates ?? [];
  const totals = data?.totals;

  const totalStreaks = useMemo(
    () => stats.reduce((acc, s) => acc + s.streak, 0),
    [stats],
  );

  const bestStreak = useMemo(
    () => (stats.length > 0 ? Math.max(...stats.map((s) => s.streak)) : 0),
    [stats],
  );

  function shiftWeek(delta: number) {
    setWeekStart(toISODate(addDays(parseISODate(weekStart), delta * 7)));
  }

  const weekEnd = toISODate(addDays(parseISODate(weekStart), 6));

  return (
    <AppShell profile={week?.profile ?? null}>
      {/* Header section with Week Switcher */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Habit Tracker</h1>
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
              Repeating
            </span>
          </div>
          <p className="num mt-1 text-sm text-muted-foreground">
            {formatDayDate(weekStart)} — {formatDayDate(weekEnd)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
            className="h-9 w-9"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => setWeekStart(toISODate(startOfWeek(new Date())))}
            className="h-9 text-xs font-medium"
          >
            This week
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
            className="h-9 w-9"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Top Overview: Dual Aggregate Pie Charts + Stats Panel */}
      <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Weekly Pie Chart */}
        <section className="flex flex-col items-center justify-between rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Calendar className="h-4 w-4 text-primary" />
              <span>Weekly Habit Progress</span>
            </div>
            <span className="num text-xs font-medium text-primary">
              {totals?.weekPct ?? 0}%
            </span>
          </div>

          <div className="my-4">
            <PieStat
              done={totals?.weekDone ?? 0}
              total={totals?.weekTarget ?? 0}
              label="This Week"
              caption={`${totals?.weekDone ?? 0} of ${totals?.weekTarget ?? 0} planned check-ins`}
              size={175}
              showTooltip={true}
            />
          </div>

          <p className="text-center text-xs text-muted-foreground">
            {totals?.weekTarget === 0
              ? "No habits created yet. Add habits below!"
              : (totals?.weekDone ?? 0) >= (totals?.weekTarget ?? 1)
                ? "🔥 Weekly target achieved! Excellent work!"
                : `${(totals?.weekTarget ?? 0) - (totals?.weekDone ?? 0)} check-ins remaining this week`}
          </p>
        </section>

        {/* Yearly Pie Chart */}
        <section className="flex flex-col items-center justify-between rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span>Year-to-Date Progress ({currentYear})</span>
            </div>
            <span className="num text-xs font-medium text-primary">
              {totals?.yearPct ?? 0}%
            </span>
          </div>

          <div className="my-4">
            <PieStat
              done={totals?.yearDone ?? 0}
              total={totals?.yearTarget ?? 0}
              label={`Year ${currentYear}`}
              caption={`${totals?.yearDone ?? 0} of ${totals?.yearTarget ?? 0} expected check-ins`}
              size={175}
              showTooltip={true}
            />
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Pro-rated consistency tracking from Jan 1 or habit creation date.
          </p>
        </section>

        {/* Quick Metrics Summary */}
        <section className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-sm md:col-span-2 lg:col-span-1">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>Habit Stats & Consistency</span>
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">Performance Summary</h2>
          </div>

          <div className="my-4 space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3.5 py-2.5">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Active Habits
              </span>
              <span className="num font-semibold text-foreground">{stats.length}</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3.5 py-2.5">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" /> Total Annual Check-ins
              </span>
              <span className="num font-semibold text-foreground">{totals?.yearDone ?? 0}</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3.5 py-2.5">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <Flame className="h-4 w-4 text-primary" /> Active Total Streaks
              </span>
              <span className="num font-semibold text-foreground">{totalStreaks} days</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3.5 py-2.5">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-400" /> Best Habit Streak
              </span>
              <span className="num font-semibold text-foreground">{bestStreak} days</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Consistency is key: habits build streaks when checked daily.
          </p>
        </section>
      </div>

      {/* Add Habit Form */}
      <form
        className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          create.mutate({ title: title.trim(), targetPerWeek: target });
          setTitle("");
        }}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New repeating habit (e.g. 30m Workout, Read Book, Meditate, Hydrate)"
          className="min-w-64 flex-1 h-10 text-sm"
        />

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Frequency:
          </label>
          <select
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="h-10 rounded-lg border border-border bg-secondary/60 px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Habit frequency target"
          >
            <option value={7}>Every day (7× / week)</option>
            <option value={6}>6× / week</option>
            <option value={5}>Weekdays (5× / week)</option>
            <option value={4}>4× / week</option>
            <option value={3}>3× / week</option>
            <option value={2}>2× / week</option>
            <option value={1}>1× / week</option>
          </select>
        </div>

        <Button type="submit" className="h-10 gap-1.5 px-4 font-medium" aria-label="Add habit">
          <Plus className="h-4 w-4" />
          <span>Add Habit</span>
        </Button>
      </form>

      {/* Habits List with 7-Day Matrix and Individual Pie Charts */}
      {isLoading ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">Loading habits…</p>
      ) : stats.length === 0 ? (
        <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/40 p-12 text-center">
          <Target className="h-10 w-10 text-muted-foreground opacity-50" />
          <h3 className="mt-4 text-base font-semibold">No habits tracked yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm">
            Add repeating habits above to track weekly targets and monitor your consistency with dedicated pie charts.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {stats.map((s) => (
            <article
              key={s.habit.id}
              className="grid gap-6 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:border-border/90 lg:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0 flex flex-col justify-between">
                {/* Title and Streak badge */}
                <div className="flex items-center gap-3">
                  <h2 className="truncate text-lg font-semibold tracking-tight">{s.habit.title}</h2>

                  <span className="num rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {s.habit.target_per_week}× / week
                  </span>

                  {s.streak > 0 && (
                    <span className="num flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
                      <Flame className="h-3.5 w-3.5" /> {s.streak}d streak
                    </span>
                  )}

                  <button
                    onClick={() => remove.mutate(s.habit.id)}
                    aria-label={`Delete ${s.habit.title}`}
                    className="ml-auto text-muted-foreground transition-colors hover:text-destructive p-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* 7-Day Checklist Matrix */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {dates.map((d, i) => {
                    const done = s.doneDates.includes(d);
                    const isTodayCheck = d === todayISO;

                    return (
                      <button
                        key={d}
                        onClick={() => toggle.mutate({ habitId: s.habit.id, date: d, done: !done })}
                        aria-label={`${done ? "Unmark" : "Mark"} ${s.habit.title} on ${formatDayDate(d)}`}
                        className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl border text-xs font-medium transition-all ${
                          done
                            ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                            : "border-border/80 bg-secondary/30 text-muted-foreground hover:border-primary hover:text-foreground"
                        } ${isTodayCheck && !done ? "ring-2 ring-primary/50" : ""}`}
                      >
                        <span className="text-[10px] uppercase">{WEEKDAY_NAMES[i]!.slice(0, 2)}</span>
                        <span className="num text-sm font-semibold">{parseISODate(d).getDate()}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Progress bar */}
                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${s.weekPct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between text-xs text-muted-foreground">
                    <span className="num">
                      <strong>{s.weekDone}</strong> / {s.weekTarget} done this week ({s.weekPct}%)
                    </span>
                    <span className="num">
                      <strong>{s.yearDone}</strong> / {s.yearTarget} YTD ({s.yearPct}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Per-Habit Individual Mini Pie Charts */}
              <div className="flex items-center justify-around gap-4 rounded-xl bg-secondary/20 p-3 lg:flex-col lg:justify-center lg:border-l lg:border-border/60 lg:pl-6">
                <PieStat
                  done={s.weekDone}
                  total={s.weekTarget}
                  label="Week"
                  size={105}
                  showTooltip={true}
                />
                <PieStat
                  done={s.yearDone}
                  total={s.yearTarget}
                  label="Year"
                  size={105}
                  showTooltip={true}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}


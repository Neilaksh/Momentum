import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Award,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Flame,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { PieStat } from "@/components/PieStat";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  addHabit,
  deleteHabit,
  getHabits,
  toggleHabitDay,
  updateHabit,
} from "@/lib/habits.functions";
import { parseHabitTitle, type HabitsData, type HabitStat } from "@/lib/habits-shared";
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
          "User-friendly repeating habit tracker with weekly targets, 1-click today check-in, and weekly & year-to-date completion pie charts.",
      },
      { property: "og:title", content: "Habit Tracker — Weekly & Yearly Progress" },
      {
        property: "og:description",
        content: "Repeating habits with weekly and yearly completion pie charts and streaks.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <HabitsPage />
    </RequireAuth>
  ),
});

const QUICK_HABIT_PRESETS = [
  { title: "🏃 30m Workout / Gym", target: 5 },
  { title: "💧 Drink 2L Water", target: 7 },
  { title: "📖 Read 20 Pages", target: 7 },
  { title: "🧘 10m Meditation", target: 7 },
  { title: "💻 Code & Learn", target: 5 },
  { title: "😴 8 Hours Sleep", target: 7 },
] as const;

type HabitFilter = "all" | "due_today" | "done_today" | "streaks";

function HabitsPage() {
  const [weekStart, setWeekStart] = useState(() => toISODate(startOfWeek(new Date())));
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState(7);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<HabitFilter>("all");
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTarget, setEditTarget] = useState(7);

  const qc = useQueryClient();
  const todayISO = toISODate(new Date());
  const currentYear = new Date().getFullYear();

  const fetchHabits = useServerFn(getHabits);
  const fetchWeek = useServerFn(getWeek);
  const toggleFn = useServerFn(toggleHabitDay);
  const addFn = useServerFn(addHabit);
  const delFn = useServerFn(deleteHabit);
  const updateFn = useServerFn(updateHabit);

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
      setTitle("");
      toast.success("Habit created successfully!");
    },
    onError: () => toast.error("Couldn't add that habit."),
  });

  const update = useMutation({
    mutationFn: (v: { id: string; title: string; targetPerWeek: number }) => updateFn({ data: v }),
    onSuccess: () => {
      invalidate();
      setEditingHabitId(null);
      toast.success("Habit updated!");
    },
    onError: () => toast.error("Couldn't update habit."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.info("Habit deleted");
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

  // Filter and search habits
  const filteredStats = useMemo(() => {
    return stats.filter((s) => {
      // Search query filter
      if (
        searchQuery.trim() &&
        !s.habit.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
      ) {
        return false;
      }
      // Tab filter
      const doneToday = s.doneDates.includes(todayISO);
      if (activeFilter === "due_today") return !doneToday && s.weekDone < s.weekTarget;
      if (activeFilter === "done_today") return doneToday;
      if (activeFilter === "streaks") return s.streak > 0;
      return true;
    });
  }, [stats, searchQuery, activeFilter, todayISO]);

  function shiftWeek(delta: number) {
    setWeekStart(toISODate(addDays(parseISODate(weekStart), delta * 7)));
  }

  const weekEnd = toISODate(addDays(parseISODate(weekStart), 6));
  const isWeeklyGoalAchieved = (totals?.weekDone ?? 0) >= (totals?.weekTarget ?? 1) && (totals?.weekTarget ?? 0) > 0;

  function startEditing(s: HabitStat) {
    setEditingHabitId(s.habit.id);
    setEditTitle(parseHabitTitle(s.habit.title).cleanTitle);
    setEditTarget(s.habit.target_per_week);
  }

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
            Week of {formatDayDate(weekStart)} — {formatDayDate(weekEnd)}
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
        <section className="flex flex-col items-center justify-between rounded-2xl border border-border bg-card p-6 shadow-sm relative overflow-hidden">
          {isWeeklyGoalAchieved && (
            <div className="absolute top-0 right-0 left-0 bg-primary/15 py-1 text-center text-[11px] font-semibold text-primary">
              🎉 Weekly Target Reached!
            </div>
          )}

          <div className={`flex w-full items-center justify-between ${isWeeklyGoalAchieved ? "mt-3" : ""}`}>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Calendar className="h-4 w-4 text-primary" />
              <span>Weekly Habit Progress</span>
            </div>
            <span className="num text-xs font-bold text-primary">
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
              ? "No habits created yet. Choose a preset below!"
              : isWeeklyGoalAchieved
                ? "🔥 All weekly habit targets achieved!"
                : `${(totals?.weekTarget ?? 0) - (totals?.weekDone ?? 0)} more check-ins needed this week`}
          </p>
        </section>

        {/* Yearly Pie Chart */}
        <section className="flex flex-col items-center justify-between rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span>Year-to-Date Progress ({currentYear})</span>
            </div>
            <span className="num text-xs font-bold text-primary">
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
            Pro-rated consistency benchmark across elapsed weeks in {currentYear}.
          </p>
        </section>

        {/* Quick Metrics Summary */}
        <section className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-sm md:col-span-2 lg:col-span-1">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>Streak & Consistency Stats</span>
            </div>
            <h2 className="mt-1.5 text-lg font-semibold tracking-tight">Consistency Summary</h2>
          </div>

          <div className="my-3 space-y-2.5">
            <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3.5 py-2">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Active Habits
              </span>
              <span className="num font-semibold text-foreground">{stats.length}</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3.5 py-2">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" /> Total Annual Check-ins
              </span>
              <span className="num font-semibold text-foreground">{totals?.yearDone ?? 0}</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3.5 py-2">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <Flame className="h-4 w-4 text-primary" /> Total Active Streaks
              </span>
              <span className="num font-semibold text-foreground">{totalStreaks} days</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3.5 py-2">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <Award className="h-4 w-4 text-amber-400" /> Best Habit Streak
              </span>
              <span className="num font-semibold text-foreground">{bestStreak} days</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Consistency tip: Checking in daily builds unbreakable streaks!
          </p>
        </section>
      </div>

      {/* User-Friendly Quick Preset Suggestions */}
      <div className="mt-6 rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2.5">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quick Habit Presets (Click to Add):
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_HABIT_PRESETS.map((preset) => (
            <button
              key={preset.title}
              onClick={() => {
                setTitle(preset.title);
                setTarget(preset.target);
              }}
              className="rounded-full border border-border/80 bg-secondary/30 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/10"
            >
              {preset.title} <span className="text-muted-foreground">({preset.target}×/wk)</span>
            </button>
          ))}
        </div>
      </div>

      {/* Add Habit Form */}
      <form
        className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          create.mutate({ title: title.trim(), targetPerWeek: target });
        }}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New repeating habit name..."
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

        <Button
          type="submit"
          className="h-10 gap-1.5 px-4 font-medium"
          disabled={create.isPending || !title.trim()}
          aria-label="Add habit"
        >
          <Plus className="h-4 w-4" />
          <span>Add Habit</span>
        </Button>
      </form>

      {/* Search & Filter Controls */}
      {stats.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-secondary/40 p-1 text-xs">
            <button
              onClick={() => setActiveFilter("all")}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                activeFilter === "all"
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Habits ({stats.length})
            </button>
            <button
              onClick={() => setActiveFilter("due_today")}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                activeFilter === "due_today"
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Due Today ({stats.filter((s) => !s.doneDates.includes(todayISO) && s.weekDone < s.weekTarget).length})
            </button>
            <button
              onClick={() => setActiveFilter("done_today")}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                activeFilter === "done_today"
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Completed Today ({stats.filter((s) => s.doneDates.includes(todayISO)).length})
            </button>
            <button
              onClick={() => setActiveFilter("streaks")}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                activeFilter === "streaks"
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Active Streaks 🔥 ({stats.filter((s) => s.streak > 0).length})
            </button>
          </div>

          <div className="relative flex items-center min-w-48">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search habits..."
              className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Habits List with 1-Click Today Check-In, 7-Day Matrix and Individual Pie Charts */}
      {isLoading ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">Loading habits…</p>
      ) : stats.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/40 p-12 text-center">
          <Target className="h-10 w-10 text-muted-foreground opacity-50" />
          <h3 className="mt-4 text-base font-semibold">No habits tracked yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm">
            Click on one of the quick presets above or type a habit name to start tracking your daily progress and building streaks.
          </p>
        </div>
      ) : filteredStats.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          No habits found matching your filter or search.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {filteredStats.map((s) => {
            const isDoneToday = s.doneDates.includes(todayISO);
            const isWeekTargetReached = s.weekDone >= s.weekTarget;
            const isEditing = editingHabitId === s.habit.id;

            return (
              <article
                key={s.habit.id}
                className={`grid gap-5 rounded-2xl border p-5 shadow-sm transition-all lg:grid-cols-[1fr_auto] ${
                  isWeekTargetReached
                    ? "border-primary/40 bg-card/90"
                    : "border-border bg-card hover:border-border/90"
                }`}
              >
                <div className="min-w-0 flex flex-col justify-between">
                  {/* Header row: Title, Badges, 1-Click Today button & Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="h-8 text-xs font-semibold w-48"
                          />
                          <select
                            value={editTarget}
                            onChange={(e) => setEditTarget(Number(e.target.value))}
                            className="h-8 rounded-md border border-border bg-secondary px-2 text-xs"
                          >
                            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                              <option key={n} value={n}>
                                {n}× / week
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            className="h-8 px-2.5 text-xs gap-1"
                            onClick={() =>
                              update.mutate({
                                id: s.habit.id,
                                title: editTitle,
                                targetPerWeek: editTarget,
                              })
                            }
                          >
                            <Check className="h-3 w-3" /> Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            onClick={() => setEditingHabitId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <>
                          <h2 className="truncate text-base font-semibold tracking-tight">
                            {parseHabitTitle(s.habit.title).displayTitle}
                          </h2>

                          <span className="num rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                            {s.habit.target_per_week}× / week
                          </span>

                          {s.streak > 0 && (
                            <span className="num flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
                              <Flame className="h-3.5 w-3.5" /> {s.streak}d streak
                            </span>
                          )}

                          {isWeekTargetReached && (
                            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                              Goal Reached
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Right action group: 1-Click Today button, Edit, Delete */}
                    <div className="flex items-center gap-2">
                      {/* Prominent 1-Click Today Check-in Button */}
                      <button
                        onClick={() =>
                          toggle.mutate({
                            habitId: s.habit.id,
                            date: todayISO,
                            done: !isDoneToday,
                          })
                        }
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                          isDoneToday
                            ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90"
                            : "border border-border/80 bg-secondary/50 text-muted-foreground hover:border-primary hover:text-foreground"
                        }`}
                        aria-label={isDoneToday ? "Unmark today" : "Check in today"}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{isDoneToday ? "Done Today" : "Check In Today"}</span>
                      </button>

                      {!isEditing && (
                        <button
                          onClick={() => startEditing(s)}
                          aria-label={`Edit ${s.habit.title}`}
                          className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        onClick={() => remove.mutate(s.habit.id)}
                        aria-label={`Delete ${s.habit.title}`}
                        className="text-muted-foreground hover:text-destructive p-1 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 7-Day Checklist Matrix */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {dates.map((d, i) => {
                      const done = s.doneDates.includes(d);
                      const isTodayCheck = d === todayISO;

                      return (
                        <button
                          key={d}
                          onClick={() =>
                            toggle.mutate({ habitId: s.habit.id, date: d, done: !done })
                          }
                          aria-label={`${done ? "Unmark" : "Mark"} ${s.habit.title} on ${formatDayDate(d)}`}
                          className={`flex h-11 w-11 flex-col items-center justify-center rounded-xl border text-xs font-medium transition-all ${
                            done
                              ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                              : "border-border/80 bg-secondary/30 text-muted-foreground hover:border-primary hover:text-foreground"
                          } ${isTodayCheck && !done ? "ring-2 ring-primary/60 border-primary" : ""}`}
                        >
                          <span className="text-[9px] uppercase font-bold">
                            {WEEKDAY_NAMES[i]!.slice(0, 2)}
                          </span>
                          <span className="num text-xs font-semibold">
                            {parseISODate(d).getDate()}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Progress bar and metrics */}
                  <div className="mt-4">
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${s.weekPct}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between text-xs text-muted-foreground">
                      <span className="num">
                        <strong>{s.weekDone}</strong> of {s.weekTarget} done this week ({s.weekPct}%)
                      </span>
                      <span className="num">
                        <strong>{s.yearDone}</strong> of {s.yearTarget} YTD ({s.yearPct}%)
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
                    size={100}
                    showTooltip={true}
                  />
                  <PieStat
                    done={s.yearDone}
                    total={s.yearTarget}
                    label="Year"
                    size={100}
                    showTooltip={true}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}



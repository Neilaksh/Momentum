import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  Award,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { WeeklyReviewBanner } from "@/components/WeeklyReviewBanner";
import { ProgressRing } from "@/components/ProgressRing";
import { PieStat } from "@/components/PieStat";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addDayTask, deleteDayTask, getGoals, getWeek, toggleDayTask } from "@/lib/tracker.functions";
import { getSubjects } from "@/lib/subjects.functions";
import { subjectColorHex, type Subject } from "@/lib/subjects-shared";
import {
  WEEKDAY_NAMES,
  XP_PER_TASK,
  XP_PERFECT_DAY,
  addDays,
  formatDayDate,
  parseISODate,
  parseRoutineTitle,
  pctComplete,
  startOfWeek,
  toISODate,
  type WeekData,
} from "@/lib/tracker-shared";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tasks — Daily & Weekly Task Tracker with Day Pie Chart" },
      {
        name: "description",
        content:
          "Unified daily and weekly task tracker: focus on today's tasks with a live completion pie chart and manage your entire 7-day schedule in one place.",
      },
      { property: "og:title", content: "Tasks — Daily & Weekly Task Tracker" },
      {
        property: "og:description",
        content:
          "A dark-mode task tracker combining focused daily completion pie charts and 7-day weekly schedule management.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <UnifiedTasksPage />
    </RequireAuth>
  ),
});

type TaskFilter = "all" | "pending" | "completed";

/** Stable key for an in-flight add-task request (target day + trimmed title). */
const addTaskKey = (date: string, title: string) => `${date}::${title}`;

function UnifiedTasksPage() {
  const [weekStart, setWeekStart] = useState(() => toISODate(startOfWeek(new Date())));
  const todayISO = toISODate(new Date());
  const [selectedDate, setSelectedDate] = useState(() => todayISO);
  const [draft, setDraft] = useState("");
  const [draftSubjectId, setDraftSubjectId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const focusPanelRef = useRef<HTMLElement>(null);
  // (date, title) pairs of add-task requests currently in flight, so a
  // double-click / double-Enter can never create duplicate rows.
  const addInflightKeys = useRef<Set<string>>(new Set());
  const qc = useQueryClient();

  const fetchWeek = useServerFn(getWeek);
  const fetchSubjectsFn = useServerFn(getSubjects);
  const toggleFn = useServerFn(toggleDayTask);
  const addFn = useServerFn(addDayTask);
  const delFn = useServerFn(deleteDayTask);

  const { data, isLoading } = useQuery({
    queryKey: ["week", weekStart],
    queryFn: () => fetchWeek({ data: { weekStart } }) as Promise<WeekData>,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["week"] });
    void qc.invalidateQueries({ queryKey: ["day"] });
    void qc.invalidateQueries({ queryKey: ["history"] });
    void qc.invalidateQueries({ queryKey: ["goals"] });
  };

  const toggle = useMutation({
    mutationFn: (v: { id: string; completed: boolean }) => toggleFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["week", weekStart] });
      const prev = qc.getQueryData<WeekData>(["week", weekStart]);
      if (prev) {
        qc.setQueryData<WeekData>(["week", weekStart], {
          ...prev,
          days: prev.days.map((d) => ({
            ...d,
            tasks: d.tasks.map((t) =>
              t.id === v.id
                ? { ...t, completed_at: v.completed ? new Date().toISOString() : null, progress_pct: v.completed ? 100 : t.progress_pct }
                : t,
            ),
          })),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["week", weekStart], ctx.prev);
      toast.error("Couldn't save that — try again.");
    },
    onSettled: invalidate,
  });

  const addTask = useMutation({
    mutationFn: (v: { date: string; title: string; subjectId?: string | null }) => addFn({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("Task added");
    },
    onError: () => toast.error("Couldn't add that task."),
    // Release the in-flight dedupe key whether the insert succeeded or failed,
    // so an intentional retry after an error is never blocked.
    onSettled: (_data, _error, variables) => {
      if (variables) addInflightKeys.current.delete(addTaskKey(variables.date, variables.title));
    },
  });

  const removeTask = useMutation({
    mutationFn: (v: { id: string }) => delFn({ data: v }),
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't delete task — try again."),
  });

  const fetchGoals = useServerFn(getGoals);
  const { data: goalsData } = useQuery({
    queryKey: ["goals"],
    queryFn: () => fetchGoals({ data: undefined }),
  });

  const goalsMap = useMemo(() => {
    const map = new Map<string, { id: string; title: string; status?: string | null }>();
    for (const g of (goalsData?.goals ?? []) as any[]) {
      map.set(g.id, g);
    }
    return map;
  }, [goalsData]);

  const { data: subjectsData } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => fetchSubjectsFn() as Promise<{ subjects: Subject[] }>,
  });
  const subjects = subjectsData?.subjects ?? [];
  const subjectsMap = useMemo(() => {
    const map = new Map<string, Subject>();
    for (const s of subjects) map.set(s.id, s);
    return map;
  }, [subjects]);
  // If the filtered subject was deleted, fall back to "All" instead of an empty list.
  const activeSubjectFilter = subjectFilter && subjectsMap.has(subjectFilter) ? subjectFilter : null;

  const days = data?.days ?? [];
  // Include direct tasks AND goal-linked repeating tasks (only unlinked routine schedule blocks stay in Routines tab)
  const days$ = days.map((d) => ({
    ...d,
    tasks: d.tasks.filter((t) => (t as any).source !== "routine" || (t as any).goal_id !== null),
  }));
  const allTasks = days$.flatMap((d) => d.tasks);
  const doneCount = allTasks.filter((t) => t.completed_at).length;
  const weekPct = pctComplete(allTasks);

  // Selected Day resolution
  const activeDay = useMemo(() => {
    const found = days$.find((d) => d.date === selectedDate);
    // Never silently retarget to a different day: if the selected date isn't in
    // the loaded week yet (week switch / refetch), keep targeting the date the
    // user actually picked instead of falling back to days$[0].
    return found ?? { date: selectedDate, weekday: 0, tasks: [] };
  }, [days$, selectedDate]);

  // Keep selected date inside active week when shifting weeks
  useEffect(() => {
    if (days.length > 0) {
      const datesInWeek = days.map((d) => d.date);
      if (!datesInWeek.includes(selectedDate)) {
        if (datesInWeek.includes(todayISO)) {
          setSelectedDate(todayISO);
        } else if (datesInWeek[0]) {
          setSelectedDate(datesInWeek[0]);
        }
      }
    }
  }, [days, weekStart, selectedDate, todayISO]);

  const activeTasks = activeDay.tasks;
  const doneActive = activeTasks.filter((t) => t.completed_at).length;
  const remainingActive = activeTasks.length - doneActive;
  const routineActiveCount = days.find((d) => d.date === selectedDate)?.tasks.filter((t) => (t as any).source === "routine").length ?? 0;
  const oneOffActiveCount = activeTasks.length;
  const isPerfectActive = activeTasks.length > 0 && doneActive === activeTasks.length;
  const activeDayXpEarned = doneActive * XP_PER_TASK + (isPerfectActive ? XP_PERFECT_DAY : 0);

  const parsedActiveDate = parseISODate(activeDay.date);
  const activeWeekdayName = WEEKDAY_NAMES[(parsedActiveDate.getDay() + 6) % 7]!;
  const isActiveDayToday = activeDay.date === todayISO;

  const filteredActiveTasks = useMemo(() => {
    let list = activeTasks;
    if (activeSubjectFilter) list = list.filter((t) => (t as any).subject_id === activeSubjectFilter);
    if (filter === "pending") return list.filter((t) => !t.completed_at);
    if (filter === "completed") return list.filter((t) => !!t.completed_at);
    return list;
  }, [activeTasks, filter, activeSubjectFilter]);

  const chartData = useMemo(
    () =>
      days$.map((d, i) => ({
        day: WEEKDAY_NAMES[i]!.slice(0, 3),
        done: d.tasks.filter((t) => t.completed_at).length,
        total: d.tasks.length,
        date: d.date,
      })),
    [days$],
  );

  function shiftWeek(delta: number) {
    const nextStart = toISODate(addDays(parseISODate(weekStart), delta * 7));
    setWeekStart(nextStart);
  }

  const weekEnd = toISODate(addDays(parseISODate(weekStart), 6));

  return (
    <AppShell profile={data?.profile ?? null}>
      {/* Weekly Review banner — visible on Monday until dismissed */}
      <WeeklyReviewBanner />

      {/* Header: Week Switcher & Jump to Today */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Tasks Dashboard</h1>
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
              Daily & Weekly
            </span>
          </div>
          <p className="num mt-1 text-sm text-muted-foreground">
            Week of {formatDayDate(weekStart)} — {formatDayDate(weekEnd)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            onClick={() => {
              const curWeekStart = toISODate(startOfWeek(new Date()));
              setWeekStart(curWeekStart);
              setSelectedDate(todayISO);
            }}
            className="h-9 text-xs font-medium"
          >
            This Week
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

      {/* Top Analytics Row: Dedicated Day Pie Chart (Left) + Week Overview Chart (Right) */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left: Selected Day Pie Chart & XP Breakdown */}
        <section className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                {isActiveDayToday ? "Today's Pie Chart" : `${activeWeekdayName}'s Pie Chart`}
              </span>
              {isPerfectActive && (
                <span className="flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <Sparkles className="h-3 w-3" /> Perfect Day
                </span>
              )}
            </div>

            <div className="my-4 flex justify-center">
              <PieStat
                done={doneActive}
                total={activeTasks.length}
                label={isActiveDayToday ? "Today's Tasks" : `${activeWeekdayName} Tasks`}
                caption={`${doneActive} of ${activeTasks.length} tasks completed`}
                size={175}
                showTooltip={true}
              />
            </div>

            <div className="space-y-2 rounded-xl bg-secondary/30 p-3.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Completed</span>
                <span className="num font-semibold text-foreground">{doneActive}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remaining</span>
                <span className="num font-semibold text-foreground">{remainingActive}</span>
              </div>
              <div className="border-t border-border/60 pt-2 flex justify-between font-medium">
                <span className="text-primary flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5" /> Day XP Gained
                </span>
                <span className="num font-bold text-primary">+{activeDayXpEarned} XP</span>
              </div>
            </div>
          </div>

          {isPerfectActive && (
            <div className="mt-4 rounded-xl border border-primary/40 bg-primary/10 p-3 text-center text-xs font-semibold text-primary animate-pulse">
              🌟 Perfect Day! All {activeTasks.length} tasks completed (+{XP_PERFECT_DAY} Bonus XP)
            </div>
          )}
        </section>

        {/* Right: Week Overview Visual Chart */}
        <section className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-4">
              <div>
                <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                  Week Overall Progress
                </p>
                <p className="num mt-1 text-2xl font-semibold">
                  {doneCount} / {allTasks.length}
                </p>
                <p className="text-xs text-muted-foreground">tasks completed this week ({weekPct}%)</p>
              </div>
            </div>

            <div className="text-xs text-muted-foreground max-w-xs">
              Click on any day tab below or bar in the chart to immediately focus and manage tasks for that day.
            </div>
          </div>

          <div className="mt-4 h-36 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, bottom: 0, left: -24 }}
                onClick={(e) => {
                  if (e && e.activePayload && e.activePayload.length) {
                    const payload = e.activePayload[0]?.payload;
                    if (payload?.date) setSelectedDate(payload.date);
                  }
                }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  allowDecimals={false}
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
                  formatter={(val: any, _name: any, item: any) => [
                    `${val} of ${item?.payload?.total ?? 0} tasks done`,
                    "Completions",
                  ]}
                />
                <Bar
                  dataKey="done"
                  fill="var(--primary)"
                  radius={[6, 6, 0, 0]}
                  className="cursor-pointer"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* 7-Day Switcher Tabs Bar */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold tracking-[0.18em] uppercase text-muted-foreground">
            Select Day to Focus
          </h2>
          <span className="text-xs text-muted-foreground">
            Active: <strong>{activeWeekdayName}, {formatDayDate(activeDay.date)}</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {days$.map((d, i) => {
            const isSelected = d.date === selectedDate;
            const isDayToday = d.date === todayISO;
            const dayDone = d.tasks.filter((t) => t.completed_at).length;
            const dayTotal = d.tasks.length;
            const isComplete = dayTotal > 0 && dayDone === dayTotal;

            return (
              <button
                key={d.date}
                onClick={() => setSelectedDate(d.date)}
                className={`flex flex-col items-center justify-between rounded-xl border p-3 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10 shadow-sm shadow-primary/20 ring-1 ring-primary"
                    : "border-border/80 bg-card hover:border-primary/50 hover:bg-secondary/40"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider">
                    {WEEKDAY_NAMES[i]!.slice(0, 3)}
                  </span>
                  {isDayToday && (
                    <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[9px] font-bold uppercase text-primary">
                      Today
                    </span>
                  )}
                  {isComplete && !isDayToday && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  )}
                </div>

                <div className="my-1.5 text-lg font-bold num">
                  {parseISODate(d.date).getDate()}
                </div>

                <div className="flex items-center gap-1.5 w-full">
                  <div className="h-1 flex-1 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{
                        width: `${dayTotal ? Math.round((dayDone / dayTotal) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <span className="num text-[10px] text-muted-foreground">
                    {dayDone}/{dayTotal}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Focused Day Task Management Panel */}
      <section ref={focusPanelRef} className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">
                {isActiveDayToday ? "Today's Tasks" : `${activeWeekdayName}'s Tasks`}
              </h2>
            </div>
            <p className="num text-xs text-muted-foreground mt-0.5">
              {formatDayDate(activeDay.date)} · {doneActive} of {activeTasks.length} completed ({activeTasks.length ? Math.round((doneActive / activeTasks.length) * 100) : 0}%)
            </p>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1 text-xs">
            <button
              onClick={() => setFilter("all")}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                filter === "all"
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All ({activeTasks.length})
            </button>
            <button
              onClick={() => setFilter("pending")}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                filter === "pending"
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Pending ({remainingActive})
            </button>
            <button
              onClick={() => setFilter("completed")}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                filter === "completed"
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Done ({doneActive})
            </button>
          </div>
        </div>

        {/* Subject Filter Chips */}
        {subjects.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setSubjectFilter(null)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                activeSubjectFilter === null
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            {subjects.map((s) => {
              const selected = activeSubjectFilter === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSubjectFilter(selected ? null : s.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    selected
                      ? "border-primary/60 bg-primary/15 text-foreground"
                      : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: subjectColorHex(s.color) }}
                  />
                  <span className="max-w-[120px] truncate">{s.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Task List for Active Day */}
        <div className="py-4">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading tasks…</p>
          ) : filteredActiveTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm font-medium text-foreground">
                {activeTasks.length === 0
                  ? `No tasks scheduled for ${activeWeekdayName}.`
                  : filter === "pending"
                    ? "All caught up! No pending tasks remaining."
                    : "No completed tasks yet."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeTasks.length === 0 ? "Add your first task below to get started." : ""}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredActiveTasks.map((t) => {
                const goalLocked =
                  !!(t as any).goal_id && goalsMap.get((t as any).goal_id)?.status === "completed";
                return (
                <li
                  key={t.id}
                  className={`group flex flex-col gap-1.5 rounded-xl border p-3 transition-all ${
                    t.completed_at
                      ? "border-border/40 bg-secondary/20 opacity-80"
                      : "border-border/80 bg-secondary/40 hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <button
                      disabled={goalLocked}
                      onClick={() => toggle.mutate({ id: t.id, completed: !t.completed_at })}
                      aria-label={
                        goalLocked
                          ? `${t.title} is locked because its goal is completed`
                          : t.completed_at
                            ? `Mark ${t.title} incomplete`
                            : `Mark ${t.title} complete`
                      }
                      title={goalLocked ? "Goal completed — task locked" : undefined}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                        goalLocked
                          ? "cursor-not-allowed border-border/60 bg-secondary/40 text-muted-foreground opacity-60"
                          : t.completed_at
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:border-primary"
                      }`}
                    >
                      {t.completed_at && (
                        <svg
                          viewBox="0 0 12 12"
                          className="h-3.5 w-3.5 stroke-primary-foreground"
                          fill="none"
                          strokeWidth={2.5}
                        >
                          <path d="M2.5 6.3l2.4 2.4 4.6-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>

                    <span
                      className={`flex-1 text-sm font-medium transition-all ${
                        t.completed_at ? "text-muted-foreground line-through" : "text-foreground"
                      }`}
                    >
                      {parseRoutineTitle(t.title).displayTitle}
                    </span>

                    {!t.completed_at && activeDay.date < todayISO && (
                      t.is_stale ? (
                        <span className="rounded-full bg-amber-500/15 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500">
                          Stale
                        </span>
                      ) : (
                        <span className="rounded-full bg-destructive/15 border border-destructive/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                          Due
                        </span>
                      )
                    )}

                    {(t as any).subject_id && subjectsMap.get((t as any).subject_id) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary/60 border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ background: subjectColorHex(subjectsMap.get((t as any).subject_id)!.color) }}
                        />
                        <span className="max-w-[100px] truncate">{subjectsMap.get((t as any).subject_id)!.name}</span>
                      </span>
                    )}

                    {(t as any).goal_id && goalsMap.get((t as any).goal_id) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        <Target className="h-2.5 w-2.5" />
                        <span className="max-w-[120px] truncate">{goalsMap.get((t as any).goal_id)?.title}</span>
                      </span>
                    )}

                    <button
                      onClick={() => removeTask.mutate({ id: t.id })}
                      aria-label={`Delete ${t.title}`}
                      className="opacity-0 transition-opacity group-hover:opacity-100 p-1 hover:text-destructive text-muted-foreground"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Add Task Form for Active Day */}
        <form
          className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const title = draft.trim();
            if (!title) return;
            // Double-submit guard: if this exact (day, title) add is already in
            // flight (double-click / Enter+click / duplicate event), drop it.
            const inflightKey = addTaskKey(activeDay.date, title);
            if (addInflightKeys.current.has(inflightKey)) return;
            addInflightKeys.current.add(inflightKey);
            addTask.mutate({ date: activeDay.date, title: draft.trim(), subjectId: draftSubjectId });
            setDraft("");
            setDraftSubjectId(null);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Add a task for ${activeWeekdayName}...`}
            className="h-10 min-w-0 flex-1 text-sm"
          />
          <select
            value={draftSubjectId ?? ""}
            onChange={(e) => setDraftSubjectId(e.target.value || null)}
            aria-label="Subject (optional)"
            className="h-10 rounded-lg border border-border bg-secondary/50 px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:w-44"
          >
            <option value="">No subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            className="h-10 shrink-0 gap-1.5 px-4"
            aria-label="Add task"
            disabled={!draft.trim()}
          >
            <Plus className="h-4 w-4" />
            <span>Add Task</span>
          </Button>
        </form>
      </section>

      {/* Full 7-Day Week Board Section (View Only) */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">Full Week Schedule</h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                View Only
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Read-only 7-day overview. Click any day card or day tab above to focus and edit its tasks.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {days$.map((day, i) => {
            const isSelected = day.date === selectedDate;
            const isDayToday = day.date === todayISO;

            return (
              <DayCard
                key={day.date}
                name={WEEKDAY_NAMES[i]!}
                date={day.date}
                isToday={isDayToday}
                isPast={day.date < todayISO}
                isSelected={isSelected}
                tasks={day.tasks}
                onSelectDay={() => {
                  setSelectedDate(day.date);
                  setTimeout(() => focusPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                }}
              />

            );
          })}
        </div>
      </section>
    </AppShell>
  );
}

function DayCard({
  name,
  date,
  isToday,
  isPast,
  isSelected,
  tasks,
  onSelectDay,
}: {
  name: string;
  date: string;
  isToday: boolean;
  isPast?: boolean;
  isSelected: boolean;
  tasks: { id: string; title: string; completed_at: string | null; source: string; is_stale?: boolean }[];
  onSelectDay: () => void;
}) {

  const pct = pctComplete(tasks);
  const doneCount = tasks.filter((t) => t.completed_at).length;

  return (
    <article
      onClick={onSelectDay}
      className={`group flex flex-col justify-between rounded-2xl border bg-card p-5 transition-all cursor-pointer hover:border-primary/60 hover:shadow-md ${
        isSelected
          ? "border-primary shadow-[0_0_0_1px_var(--primary)] ring-1 ring-primary"
          : isToday
            ? "border-primary/50"
            : "border-border"
      }`}
    >
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold tracking-tight group-hover:text-primary transition-colors">
              {name}
            </h3>
            <p className="num text-xs text-muted-foreground">{formatDayDate(date)}</p>
          </div>

          <div className="flex items-center gap-1.5">
            {isToday && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-primary">
                Today
              </span>
            )}
            {isSelected && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                Focused
              </span>
            )}
          </div>
        </div>

        <div className="my-3 flex justify-center">
          <ProgressRing value={pct} size={76} stroke={7} />
        </div>

        <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="num font-medium">
            {doneCount} of {tasks.length} done
          </span>
          <span className="num font-semibold text-foreground">{pct}%</span>
        </div>

        {/* Read-only Task List */}
        <ul className="space-y-1.5 my-2 max-h-48 overflow-y-auto pr-1">
          {tasks.length === 0 && (
            <li className="text-xs text-muted-foreground py-2 italic text-center">
              No tasks scheduled.
            </li>
          )}
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex flex-col gap-0.5 rounded-lg px-2 py-1 text-xs transition-colors bg-secondary/20"
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 shrink-0">
                  {t.completed_at ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
                  )}
                </div>
                <span
                  className={`flex-1 leading-snug truncate ${
                    t.completed_at ? "text-muted-foreground line-through" : "text-foreground"
                  }`}
                >
                  {parseRoutineTitle(t.title).displayTitle}
                </span>
                {isPast && !t.completed_at && (
                  t.is_stale ? (
                    <span className="shrink-0 rounded-full bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-500">
                      Stale
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-destructive/15 border border-destructive/30 px-1.5 py-0.5 text-[9px] font-bold uppercase text-destructive">
                      Due
                    </span>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Focus day action footer */}
      <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground group-hover:text-primary transition-colors">
        <span>{isSelected ? "Currently active in editor" : "Click card to focus & edit"}</span>
        <ChevronRight className="h-3.5 w-3.5 transform group-hover:translate-x-1 transition-transform" />
      </div>
    </article>
  );
}



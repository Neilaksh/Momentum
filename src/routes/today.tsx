import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Award,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { PieStat } from "@/components/PieStat";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addDayTask, deleteDayTask, getDay, toggleDayTask } from "@/lib/tracker.functions";
import {
  WEEKDAY_NAMES,
  XP_PER_TASK,
  XP_PERFECT_DAY,
  addDays,
  formatDayDate,
  parseISODate,
  toISODate,
  type DayTask,
  type Profile,
} from "@/lib/tracker-shared";

export const Route = createFileRoute("/today")({
  head: () => ({
    meta: [
      { title: "Daily Tasks — Momentum Life Tracker" },
      {
        name: "description",
        content:
          "Dedicated daily task tracker with real-time day completion pie chart, routine integration, and XP calculation.",
      },
      { property: "og:title", content: "Daily Tasks — Momentum Life Tracker" },
      {
        property: "og:description",
        content: "A focused daily task view with a live completion pie chart and XP calculation.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <DailyPage />
    </RequireAuth>
  ),
});

type DayData = {
  date: string;
  tasks: DayTask[];
  profile: Profile | null;
  done: number;
  total: number;
  pct: number;
};

type TaskFilter = "all" | "pending" | "completed";

function DailyPage() {
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const qc = useQueryClient();

  const fetchDay = useServerFn(getDay);
  const toggleFn = useServerFn(toggleDayTask);
  const addFn = useServerFn(addDayTask);
  const delFn = useServerFn(deleteDayTask);

  const { data, isLoading } = useQuery({
    queryKey: ["day", date],
    queryFn: () => fetchDay({ data: { date } }) as Promise<DayData>,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["day"] });
    void qc.invalidateQueries({ queryKey: ["week"] });
    void qc.invalidateQueries({ queryKey: ["history"] });
    void qc.invalidateQueries({ queryKey: ["goals"] });
  };

  const toggle = useMutation({
    mutationFn: (v: { id: string; completed: boolean }) => toggleFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["day", date] });
      const prev = qc.getQueryData<DayData>(["day", date]);
      if (prev) {
        const tasks = prev.tasks.map((t) =>
          t.id === v.id
            ? { ...t, completed_at: v.completed ? new Date().toISOString() : null }
            : t,
        );
        const done = tasks.filter((t) => t.completed_at).length;
        qc.setQueryData<DayData>(["day", date], {
          ...prev,
          tasks,
          done,
          pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["day", date], ctx.prev);
      toast.error("Couldn't save that — try again.");
    },
    onSettled: invalidate,
  });

  const addTask = useMutation({
    mutationFn: (title: string) => addFn({ data: { date, title } }),
    onSuccess: () => {
      invalidate();
      toast.success("Task added to today's list");
    },
    onError: () => toast.error("Couldn't add that task."),
  });

  const removeTask = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: invalidate,
  });

  const tasks = data?.tasks ?? [];
  const done = tasks.filter((t) => t.completed_at).length;
  const remaining = tasks.length - done;
  const routineCount = tasks.filter((t) => t.source === "routine").length;
  const oneOffCount = tasks.length - routineCount;
  const isPerfectDay = tasks.length > 0 && done === tasks.length;
  const dayXpEarned = done * XP_PER_TASK + (isPerfectDay ? XP_PERFECT_DAY : 0);

  const parsed = parseISODate(date);
  const weekdayName = WEEKDAY_NAMES[(parsed.getDay() + 6) % 7]!;
  const todayISO = toISODate(new Date());
  const isToday = date === todayISO;

  const filteredTasks = useMemo(() => {
    if (filter === "pending") return tasks.filter((t) => !t.completed_at);
    if (filter === "completed") return tasks.filter((t) => !!t.completed_at);
    return tasks;
  }, [tasks, filter]);

  function shift(delta: number) {
    setDate(toISODate(addDays(parsed, delta)));
  }

  return (
    <AppShell profile={data?.profile ?? null}>
      {/* Header section with Date Navigation */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {isToday ? "Today's Tasks" : `${weekdayName}'s Tasks`}
            </h1>
            {isToday && (
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
                Today
              </span>
            )}
          </div>
          <p className="num mt-1 text-sm text-muted-foreground">
            {weekdayName}, {formatDayDate(date)}
          </p>
        </div>

        {/* Date switchers & picker */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => shift(-1)}
            aria-label="Previous day"
            className="h-9 w-9"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Button
            variant={isToday ? "secondary" : "outline"}
            onClick={() => setDate(toISODate(new Date()))}
            className="h-9 text-xs font-medium"
          >
            Jump to Today
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => shift(1)}
            aria-label="Next day"
            className="h-9 w-9"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <div className="relative flex items-center">
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-9 rounded-md border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="Pick date"
            />
          </div>
        </div>
      </div>

      {/* Main Grid: Dedicated Pie Chart + Task List */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left Card: Day Pie Chart & Statistics */}
        <section className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-[0.18em] uppercase text-muted-foreground">
              Day Completion Chart
            </h2>
            {isPerfectDay && (
              <span className="flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary">
                <Sparkles className="h-3 w-3" /> Perfect Day
              </span>
            )}
          </div>

          <div className="my-5 flex justify-center">
            <PieStat
              done={done}
              total={tasks.length}
              label={isToday ? "Today's Progress" : `${weekdayName} Progress`}
              caption={`${done} of ${tasks.length} tasks completed`}
              size={190}
              showTooltip={true}
            />
          </div>

          {/* Breakdown & XP calculation */}
          <div className="space-y-3 rounded-xl border border-border/60 bg-secondary/30 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" /> Completed
              </span>
              <span className="num font-semibold text-foreground">{done}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Circle className="h-4 w-4 text-muted-foreground" /> Remaining
              </span>
              <span className="num font-semibold text-foreground">{remaining}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted-foreground">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" /> From Routine
              </span>
              <span className="num font-semibold text-foreground">{routineCount}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Plus className="h-4 w-4 text-muted-foreground" /> One-off Tasks
              </span>
              <span className="num font-semibold text-foreground">{oneOffCount}</span>
            </div>

            <div className="border-t border-border/60 pt-2.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-primary">
                <Zap className="h-3.5 w-3.5" /> Day XP Gained
              </span>
              <span className="num font-bold text-primary">+{dayXpEarned} XP</span>
            </div>
          </div>

          {isPerfectDay && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-xs text-primary border border-primary/20">
              <Award className="h-5 w-5 shrink-0" />
              <span>
                <strong>100% Complete!</strong> You earned +{XP_PERFECT_DAY} bonus XP for completing all tasks today.
              </span>
            </div>
          )}
        </section>

        {/* Right Card: Interactive Task List & Add Form */}
        <section className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Tasks for this day</h2>
              <p className="text-xs text-muted-foreground">
                Tick off tasks to immediately update your day pie chart.
              </p>
            </div>

            {/* Filter buttons */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1 text-xs">
              <button
                onClick={() => setFilter("all")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filter === "all"
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({tasks.length})
              </button>
              <button
                onClick={() => setFilter("pending")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filter === "pending"
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Pending ({remaining})
              </button>
              <button
                onClick={() => setFilter("completed")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filter === "completed"
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Done ({done})
              </button>
            </div>
          </div>

          {/* Task List */}
          <div className="flex-1 py-4">
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading tasks…</p>
            ) : filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm font-medium text-foreground">
                  {tasks.length === 0
                    ? "No tasks scheduled for this day yet."
                    : filter === "pending"
                      ? "All caught up! No pending tasks left."
                      : "No completed tasks yet."}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tasks.length === 0 ? "Add your first task below to get started." : ""}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {filteredTasks.map((t) => (
                  <li
                    key={t.id}
                    className={`group flex items-center gap-3 rounded-xl border p-3 transition-all ${
                      t.completed_at
                        ? "border-border/40 bg-secondary/20 opacity-80"
                        : "border-border/80 bg-secondary/40 hover:border-primary/50"
                    }`}
                  >
                    <button
                      onClick={() => toggle.mutate({ id: t.id, completed: !t.completed_at })}
                      aria-label={t.completed_at ? `Mark ${t.title} incomplete` : `Mark ${t.title} complete`}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                        t.completed_at
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
                      {t.title}
                    </span>

                    {t.source === "routine" && (
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase text-muted-foreground">
                        Routine
                      </span>
                    )}

                    <button
                      onClick={() => removeTask.mutate(t.id)}
                      aria-label={`Delete ${t.title}`}
                      className="opacity-0 transition-opacity group-hover:opacity-100 p-1 hover:text-destructive text-muted-foreground"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add Task Input Form */}
          <form
            className="mt-auto flex gap-2 border-t border-border/60 pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              addTask.mutate(draft.trim());
              setDraft("");
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a new task for this day..."
              className="h-10 text-sm"
            />
            <Button type="submit" className="h-10 shrink-0 gap-1.5 px-4" aria-label="Add task">
              <Plus className="h-4 w-4" />
              <span>Add Task</span>
            </Button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}


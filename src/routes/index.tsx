import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
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
import { ProgressRing } from "@/components/ProgressRing";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addDayTask, deleteDayTask, getWeek, toggleDayTask } from "@/lib/tracker.functions";
import {
  WEEKDAY_NAMES,
  addDays,
  formatDayDate,
  parseISODate,
  pctComplete,
  startOfWeek,
  toISODate,
  type WeekData,
} from "@/lib/tracker-shared";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Momentum — Weekly Life Tracker with Streaks & XP" },
      {
        name: "description",
        content:
          "Track your week day by day: recurring routines, one-off tasks, completion rings, streaks, XP levels and long-term goals — synced across all your devices.",
      },
      { property: "og:title", content: "Momentum — Weekly Life Tracker with Streaks & XP" },
      {
        property: "og:description",
        content:
          "A dark-mode weekly task tracker with completion rings, streaks, XP levels and goals, synced everywhere.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <WeekBoard />
    </RequireAuth>
  ),
});

function WeekBoard() {
  const [weekStart, setWeekStart] = useState(() => toISODate(startOfWeek(new Date())));
  const fetchWeek = useServerFn(getWeek);
  const qc = useQueryClient();
  const todayISO = toISODate(new Date());

  const { data, isLoading } = useQuery({
    queryKey: ["week", weekStart],
    queryFn: () => fetchWeek({ data: { weekStart } }) as Promise<WeekData>,
  });

  const toggleFn = useServerFn(toggleDayTask);
  const addFn = useServerFn(addDayTask);
  const delFn = useServerFn(deleteDayTask);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["week"] });
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
              t.id === v.id ? { ...t, completed_at: v.completed ? new Date().toISOString() : null } : t,
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
    mutationFn: (v: { date: string; title: string }) => addFn({ data: v }),
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't add that task."),
  });

  const removeTask = useMutation({
    mutationFn: (v: { id: string }) => delFn({ data: v }),
    onSuccess: invalidate,
  });

  const days = data?.days ?? [];
  const allTasks = days.flatMap((d) => d.tasks);
  const doneCount = allTasks.filter((t) => t.completed_at).length;

  const chartData = useMemo(
    () =>
      days.map((d, i) => ({
        day: WEEKDAY_NAMES[i]!.slice(0, 3),
        done: d.tasks.filter((t) => t.completed_at).length,
      })),
    [days],
  );

  function shiftWeek(delta: number) {
    setWeekStart(toISODate(addDays(parseISODate(weekStart), delta * 7)));
  }

  const weekEnd = toISODate(addDays(parseISODate(weekStart), 6));

  return (
    <AppShell profile={data?.profile ?? null}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">This week</h1>
          <p className="num mt-1 text-sm text-muted-foreground">
            {formatDayDate(weekStart)} — {formatDayDate(weekEnd)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftWeek(-1)} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setWeekStart(toISODate(startOfWeek(new Date())))}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => shiftWeek(1)} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <section className="mt-6 grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-5">
          <ProgressRing value={pctComplete(allTasks)} size={104} stroke={10} />
          <div>
            <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground">Overall progress</p>
            <p className="num mt-1 text-2xl font-semibold">
              {doneCount} / {allTasks.length}
            </p>
            <p className="text-xs text-muted-foreground">tasks completed</p>
          </div>
        </div>
        <div className="h-32 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
              <Tooltip
                cursor={{ fill: "var(--secondary)" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="done" fill="var(--primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Quick Access Highlights */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link
          to="/today"
          className="group flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/60 hover:bg-secondary/40"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Plus className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight group-hover:text-primary transition-colors">
                Daily Tasks View
              </p>
              <p className="text-xs text-muted-foreground">
                Dedicated day view with completion pie chart & XP breakdown
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </Link>

        <Link
          to="/habits"
          className="group flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/60 hover:bg-secondary/40"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ChevronRight className="h-5 w-5 rotate-45" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight group-hover:text-primary transition-colors">
                Repeating Habit Tracker
              </p>
              <p className="text-xs text-muted-foreground">
                Weekly & yearly progress pie charts with streaks
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </Link>
      </div>

      {isLoading ? (
        <p className="mt-10 text-sm text-muted-foreground">Loading your week…</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {days.map((day, i) => (
            <DayCard
              key={day.date}
              name={WEEKDAY_NAMES[i]!}
              date={day.date}
              isToday={day.date === todayISO}
              tasks={day.tasks}
              onToggle={(id, completed) => toggle.mutate({ id, completed })}
              onAdd={(title) => addTask.mutate({ date: day.date, title })}
              onDelete={(id) => removeTask.mutate({ id })}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function DayCard({
  name,
  date,
  isToday,
  tasks,
  onToggle,
  onAdd,
  onDelete,
}: {
  name: string;
  date: string;
  isToday: boolean;
  tasks: { id: string; title: string; completed_at: string | null; source: string }[];
  onToggle: (id: string, completed: boolean) => void;
  onAdd: (title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const pct = pctComplete(tasks);

  return (
    <article
      className={`flex flex-col rounded-2xl border bg-card p-5 transition-colors ${
        isToday ? "border-primary/60 shadow-[0_0_0_1px_var(--primary)]" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{name}</h2>
          <p className="num text-xs text-muted-foreground">{formatDayDate(date)}</p>
        </div>
        {isToday && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-primary">
            Today
          </span>
        )}
      </div>

      <div className="my-4 flex justify-center">
        <ProgressRing value={pct} size={92} stroke={9} />
      </div>

      <ul className="flex-1 space-y-1">
        {tasks.length === 0 && <li className="text-xs text-muted-foreground">No tasks yet.</li>}
        {tasks.map((t) => (
          <li key={t.id} className="group flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-secondary/60">
            <button
              onClick={() => onToggle(t.id, !t.completed_at)}
              aria-label={t.completed_at ? `Mark ${t.title} incomplete` : `Mark ${t.title} complete`}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
                t.completed_at ? "border-primary bg-primary" : "border-border hover:border-primary"
              }`}
            >
              {t.completed_at && (
                <svg viewBox="0 0 12 12" className="h-3 w-3 stroke-primary-foreground" fill="none" strokeWidth={2}>
                  <path d="M2.5 6.3l2.4 2.4 4.6-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span
              className={`flex-1 text-sm leading-snug ${
                t.completed_at ? "text-muted-foreground line-through" : "text-foreground"
              }`}
            >
              {t.title}
            </span>
            <button
              onClick={() => onDelete(t.id)}
              aria-label={`Delete ${t.title}`}
              className="opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </li>
        ))}
      </ul>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onAdd(draft.trim());
          setDraft("");
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add task"
          className="h-8 text-sm"
        />
        <Button type="submit" size="icon" variant="secondary" className="h-8 w-8 shrink-0" aria-label="Add task">
          <Plus className="h-4 w-4" />
        </Button>
      </form>
    </article>
  );
}

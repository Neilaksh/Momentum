import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { PieStat } from "@/components/PieStat";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addDayTask, deleteDayTask, getDay, toggleDayTask } from "@/lib/tracker.functions";
import {
  WEEKDAY_NAMES,
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
          "Focus on one day at a time: tick off today's tasks and watch your daily completion pie chart fill up.",
      },
      { property: "og:title", content: "Daily Tasks — Momentum Life Tracker" },
      {
        property: "og:description",
        content: "A focused daily task view with a live completion pie chart.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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

function DailyPage() {
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [draft, setDraft] = useState("");
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
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't add that task."),
  });

  const removeTask = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: invalidate,
  });

  const tasks = data?.tasks ?? [];
  const done = tasks.filter((t) => t.completed_at).length;
  const routineCount = tasks.filter((t) => t.source === "routine").length;
  const parsed = parseISODate(date);
  const weekdayName = WEEKDAY_NAMES[(parsed.getDay() + 6) % 7]!;
  const isToday = date === toISODate(new Date());

  function shift(delta: number) {
    setDate(toISODate(addDays(parsed, delta)));
  }

  return (
    <AppShell profile={data?.profile ?? null}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {isToday ? "Today" : weekdayName}
          </h1>
          <p className="num mt-1 text-sm text-muted-foreground">{formatDayDate(date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setDate(toISODate(new Date()))}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="rounded-2xl border border-border bg-card p-6">
          <PieStat done={done} total={tasks.length} label="Day completion" size={190} />
          <dl className="mt-6 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Completed</dt>
              <dd className="num font-semibold">{done}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Remaining</dt>
              <dd className="num font-semibold">{tasks.length - done}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">From routine</dt>
              <dd className="num font-semibold">{routineCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">One-off</dt>
              <dd className="num font-semibold">{tasks.length - routineCount}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold tracking-[0.18em] uppercase text-muted-foreground">
            Tasks
          </h2>

          {isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="mt-4 space-y-1">
              {tasks.length === 0 && (
                <li className="text-sm text-muted-foreground">Nothing planned for this day yet.</li>
              )}
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary/60"
                >
                  <button
                    onClick={() => toggle.mutate({ id: t.id, completed: !t.completed_at })}
                    aria-label={t.completed_at ? `Mark ${t.title} incomplete` : `Mark ${t.title} complete`}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
                      t.completed_at ? "border-primary bg-primary" : "border-border hover:border-primary"
                    }`}
                  >
                    {t.completed_at && (
                      <svg
                        viewBox="0 0 12 12"
                        className="h-3.5 w-3.5 stroke-primary-foreground"
                        fill="none"
                        strokeWidth={2}
                      >
                        <path d="M2.5 6.3l2.4 2.4 4.6-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                  <span
                    className={`flex-1 text-sm ${
                      t.completed_at ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                  >
                    {t.title}
                  </span>
                  {t.source === "routine" && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] tracking-wider uppercase text-muted-foreground">
                      Routine
                    </span>
                  )}
                  <button
                    onClick={() => removeTask.mutate(t.id)}
                    aria-label={`Delete ${t.title}`}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="mt-5 flex gap-2"
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
              placeholder="Add a task for this day"
            />
            <Button type="submit" aria-label="Add task">
              <Plus className="h-4 w-4" />
            </Button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}

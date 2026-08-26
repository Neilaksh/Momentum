import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Flame, Plus, Trash2 } from "lucide-react";
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
} from "@/lib/tracker-shared";
import { getWeek } from "@/lib/tracker.functions";
import type { WeekData } from "@/lib/tracker-shared";

export const Route = createFileRoute("/habits")({
  head: () => ({
    meta: [
      { title: "Habit Tracker — Weekly & Yearly Progress | Momentum" },
      {
        name: "description",
        content:
          "Track repeating habits with weekly targets, a weekly completion pie chart and a year-to-date pie chart showing your long-term consistency.",
      },
      { property: "og:title", content: "Habit Tracker — Weekly & Yearly Progress" },
      {
        property: "og:description",
        content: "Repeating habits with weekly and yearly completion pie charts and streaks.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["habits"] });

  const toggle = useMutation({
    mutationFn: (v: { habitId: string; date: string; done: boolean }) => toggleFn({ data: v }),
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't save that — try again."),
  });

  const create = useMutation({
    mutationFn: (v: { title: string; targetPerWeek: number }) => addFn({ data: v }),
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't add that habit."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: invalidate,
  });

  const stats = data?.stats ?? [];
  const dates = data?.dates ?? [];
  const totals = data?.totals;

  function shiftWeek(delta: number) {
    setWeekStart(toISODate(addDays(parseISODate(weekStart), delta * 7)));
  }

  return (
    <AppShell profile={week?.profile ?? null}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Habits</h1>
          <p className="num mt-1 text-sm text-muted-foreground">
            {formatDayDate(weekStart)} — {formatDayDate(toISODate(addDays(parseISODate(weekStart), 6)))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftWeek(-1)} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setWeekStart(toISODate(startOfWeek(new Date())))}>
            This week
          </Button>
          <Button variant="outline" size="icon" onClick={() => shiftWeek(1)} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <section className="mt-6 grid gap-6 rounded-2xl border border-border bg-card p-6 sm:grid-cols-2">
        <PieStat
          done={totals?.weekDone ?? 0}
          total={totals?.weekTarget ?? 0}
          label="This week"
          caption={`${totals?.weekDone ?? 0} of ${totals?.weekTarget ?? 0} planned check-ins`}
          size={180}
        />
        <PieStat
          done={totals?.yearDone ?? 0}
          total={totals?.yearTarget ?? 0}
          label={`Year ${new Date().getFullYear()}`}
          caption={`${totals?.yearDone ?? 0} of ${totals?.yearTarget ?? 0} expected so far`}
          size={180}
        />
      </section>

      <form
        className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-4"
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
          placeholder="New habit (e.g. Gym, Read 20 pages)"
          className="min-w-48 flex-1"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Target
          <select
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}× / week
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">
          <Plus className="mr-1 h-4 w-4" /> Add habit
        </Button>
      </form>

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading your habits…</p>
      ) : stats.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No habits yet — add your first repeating habit above.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {stats.map((s) => (
            <article
              key={s.habit.id}
              className="grid gap-4 rounded-2xl border border-border bg-card p-5 lg:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <h2 className="truncate text-lg font-semibold tracking-tight">{s.habit.title}</h2>
                  <span className="num rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                    {s.habit.target_per_week}× / week
                  </span>
                  {s.streak > 0 && (
                    <span className="num flex items-center gap-1 text-xs text-primary">
                      <Flame className="h-3.5 w-3.5" /> {s.streak}d
                    </span>
                  )}
                  <button
                    onClick={() => remove.mutate(s.habit.id)}
                    aria-label={`Delete ${s.habit.title}`}
                    className="ml-auto text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {dates.map((d, i) => {
                    const done = s.doneDates.includes(d);
                    const future = d > todayISO;
                    return (
                      <button
                        key={d}
                        disabled={future}
                        onClick={() => toggle.mutate({ habitId: s.habit.id, date: d, done: !done })}
                        aria-label={`${done ? "Unmark" : "Mark"} ${s.habit.title} on ${formatDayDate(d)}`}
                        className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl border text-[11px] transition-all ${
                          done
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:border-primary"
                        } ${future ? "opacity-40" : ""} ${d === todayISO && !done ? "ring-1 ring-primary/50" : ""}`}
                      >
                        <span className="font-semibold">{WEEKDAY_NAMES[i]!.slice(0, 2)}</span>
                        <span className="num">{parseISODate(d).getDate()}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${s.weekPct}%` }}
                  />
                </div>
                <p className="num mt-2 text-xs text-muted-foreground">
                  {s.weekDone}/{s.weekTarget} this week · {s.yearDone}/{s.yearTarget} this year (
                  {s.yearPct}%)
                </p>
              </div>

              <div className="flex gap-4 lg:pl-4">
                <PieStat done={s.weekDone} total={s.weekTarget} label="Week" size={104} />
                <PieStat done={s.yearDone} total={s.yearTarget} label="Year" size={104} />
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}

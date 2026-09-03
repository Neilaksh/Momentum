import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BookOpen,
  CalendarRange,
  CheckCircle2,
  Flame,
  Save,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/StatCard";
import { getWeeklyReview, saveWeeklyReflection } from "@/lib/weekly-review.functions";
import { subjectColorHex } from "@/lib/subjects-shared";
import { formatDayDate } from "@/lib/tracker-shared";
import type { WeeklyReview } from "@/lib/weekly-review-shared";

const STREAK_LABEL: Record<string, string> = {
  extended: "Extended",
  maintained: "Maintained",
  broken: "Broken",
  none: "No activity",
};



export function WeeklyReviewView({
  weekStart,
}: {
  weekStart: string;
}) {
  const fetchReview = useServerFn(getWeeklyReview);
  const saveReflectionFn = useServerFn(saveWeeklyReflection);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["weekly-review", weekStart],
    queryFn: () => fetchReview({ data: { weekStart } }) as Promise<{ review: WeeklyReview }>,
  });

  const review = data?.review;
  const [draft, setDraft] = useState<string | null>(null);

  const saveReflection = useMutation({
    mutationFn: (text: string) => saveReflectionFn({ data: { weekStart, reflectionText: text } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["weekly-review", weekStart] });
      void qc.invalidateQueries({ queryKey: ["weekly-reviews"] });
      toast.success("Reflection saved.");
    },
    onError: () => toast.error("Couldn't save reflection."),
  });

  const chart = (review?.daily ?? []).map((d) => ({ label: d.label, done: d.done }));

  return (
    <div className="space-y-6">
      {isLoading || !review ? (
        <p className="text-sm text-muted-foreground">Loading weekly review…</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-primary">
            <CalendarRange className="h-4 w-4" />
            <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              Week of {formatDayDate(review.weekStart)} – {formatDayDate(review.weekEnd)}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Completion rate" value={`${review.completionRate}%`} sub={`${review.completedTasks} / ${review.totalTasks} tasks`} />
            <StatCard icon={<Zap className="h-4 w-4" />} label="XP earned" value={`${review.xpEarned}`} sub="this week" />
            <StatCard icon={<Flame className="h-4 w-4" />} label="Streak" value={STREAK_LABEL[review.streakStatus] ?? "None"} sub={review.activeDaysInWeek ? `${review.activeDaysInWeek} active day${review.activeDaysInWeek !== 1 ? "s" : ""} this week` : "no tasks completed"} />
            <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Habits" value={`${review.habitRate}%`} sub={`${review.habitDone} / ${review.habitTarget} target`} />
          </div>


          <div className="grid gap-6 lg:grid-cols-2">
            {/* Daily completions */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                Daily completions · Mon – Sun
              </p>
              <div className="mt-3 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                    <Tooltip
                      cursor={{ fill: "var(--secondary)" }}
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                      formatter={(val: any) => [`${val} completed`, "Tasks"]}
                    />
                    <Bar dataKey="done" radius={[6, 6, 0, 0]}>
                      {chart.map((_, i) => (
                        <Cell key={i} fill="var(--primary)" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Habits */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Habits</p>
              {review.habits.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">No habits tracked this week.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {review.habits.map((h) => (
                    <li key={h.id} className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectColorHex(h.color) }} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{h.title}</span>
                      <span className="num text-xs font-semibold text-primary">{h.done}/{h.target}</span>
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${h.pct}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>


          {/* Goals */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-primary">
              <Target className="h-4 w-4" />
              <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Goals</p>
            </div>
            {review.goals.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                No goals changed or completed this week.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {review.goals.map((g) => (
                  <li key={g.id} className="flex items-center gap-2.5 rounded-lg bg-secondary/40 px-3 py-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectColorHex(g.color) }} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{g.title}</span>
                    {g.isNewlyCompleted ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Completed</span>
                    ) : g.isNewlyCreated ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Created</span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {g.status === "overdue" ? "Overdue" : g.status === "active" ? "Updated" : g.status}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Subject breakdown */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-primary">
              <BookOpen className="h-4 w-4" />
              <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">By Subject</p>
            </div>
            {review.subjects.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                No tagged tasks completed this week.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={review.subjects.map((e) => ({ name: e.name, count: e.count, color: subjectColorHex(e.color) }))} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid horizontal={false} stroke="var(--border)" />
                      <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                      <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                      <Tooltip cursor={{ fill: "var(--secondary)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} formatter={(val: any) => [`${val} completed`, "Tasks"]} />
                      <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                        {review.subjects.map((e, i) => (
                          <Cell key={`${e.name}-${i}`} fill={subjectColorHex(e.color)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ol className="space-y-2 self-start">
                  {review.subjects.map((e, i) => (
                    <li key={e.subjectId} className="flex items-center gap-2.5 rounded-lg bg-secondary/40 px-3 py-2">
                      <span className="num w-4 shrink-0 text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectColorHex(e.color) }} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{e.name}</span>
                      <span className="num text-xs font-semibold text-primary">{e.count}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>

          {/* Reflection */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              Reflection / intention for next week
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Input
                value={draft ?? review.reflection ?? ""}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="One line for next week…"
                className="flex-1"
                maxLength={300}
              />
              <Button
                onClick={() => saveReflection.mutate(draft ?? review.reflection ?? "")}
                disabled={saveReflection.isPending || (draft ?? review.reflection ?? "").trim() === ""}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                Save
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}


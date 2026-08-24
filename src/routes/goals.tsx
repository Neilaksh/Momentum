import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Target, Trash2 } from "lucide-react";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { deleteGoal, getGoals, saveGoal } from "@/lib/tracker.functions";
import { formatDayDate, type Goal } from "@/lib/tracker-shared";

export const Route = createFileRoute("/goals")({
  head: () => ({
    meta: [
      { title: "Long-term Goals — Momentum" },
      {
        name: "description",
        content:
          "Set long-term goals with target dates and watch progress build from the daily tasks you link to them.",
      },
      { property: "og:title", content: "Long-term Goals — Momentum" },
      {
        property: "og:description",
        content: "Turn daily task completion into visible progress on the goals that matter.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <GoalsPage />
    </RequireAuth>
  ),
});

type GoalsResponse = { goals: Goal[]; stats: Record<string, { total: number; done: number }> };

function GoalsPage() {
  const fetchGoals = useServerFn(getGoals);
  const saveFn = useServerFn(saveGoal);
  const delFn = useServerFn(deleteGoal);
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const { data } = useQuery({
    queryKey: ["goals"],
    queryFn: () => fetchGoals({ data: undefined }) as Promise<GoalsResponse>,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["goals"] });

  const create = useMutation({
    mutationFn: (v: { title: string; description: string | null; targetDate: string | null }) =>
      saveFn({ data: v }),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setTargetDate("");
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (v: { id: string }) => delFn({ data: v }),
    onSuccess: invalidate,
  });

  const goals = data?.goals ?? [];
  const stats = data?.stats ?? {};

  return (
    <AppShell>
      <h1 className="text-3xl font-semibold tracking-tight">Long-term goals</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Progress fills up as you complete tasks linked to each goal.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <form
          className="h-fit space-y-4 rounded-2xl border border-border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            create.mutate({
              title: title.trim(),
              description: description.trim() || null,
              targetDate: targetDate || null,
            });
          }}
        >
          <h2 className="text-sm font-semibold tracking-[0.18em] uppercase text-muted-foreground">
            New goal
          </h2>
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="target">Target date</Label>
            <Input
              id="target"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Add goal
          </Button>
        </form>

        <div className="space-y-3">
          {goals.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No goals yet. Add your first one on the left.
            </div>
          )}
          {goals.map((g) => {
            const s = stats[g.id] ?? { total: 0, done: 0 };
            const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
            return (
              <article key={g.id} className="group rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start gap-3">
                  <Target className="mt-1 h-4 w-4 shrink-0 text-primary" />
                  <div className="flex-1">
                    <h3 className="font-semibold tracking-tight">{g.title}</h3>
                    {g.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{g.description}</p>
                    )}
                    {g.target_date && (
                      <p className="num mt-1 text-xs text-muted-foreground">
                        Target {formatDayDate(g.target_date)}
                      </p>
                    )}
                  </div>
                  <span className="num text-sm font-semibold text-primary">{pct}%</span>
                  <button
                    onClick={() => remove.mutate({ id: g.id })}
                    aria-label={`Delete ${g.title}`}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="num mt-2 text-xs text-muted-foreground">
                  {s.done} / {s.total} linked tasks completed
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

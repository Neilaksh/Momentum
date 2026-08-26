import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LinkIcon,
  Plus,
  RefreshCw,
  Repeat,
  Target,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  addGoalRoutineTask,
  deleteGoal,
  getGoals,
  removeGoalRoutineTasksBatch,
  saveGoal,
  updateGoalStatus,
} from "@/lib/tracker.functions";
import { getWeek } from "@/lib/tracker.functions";
import {
  formatDayDate,
  startOfWeek,
  toISODate,
  WEEKDAY_NAMES,
  type Goal,
  type WeekData,
} from "@/lib/tracker-shared";

export const Route = createFileRoute("/goals")({
  head: () => ({
    meta: [
      { title: "Long-term Goals — Momentum" },
      {
        name: "description",
        content:
          "Set long-term goals, link repeating daily tasks that auto-generate every week, and track progress until the goal is complete.",
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

type GoalsResponse = {
  goals: Goal[];
  stats: Record<string, { total: number; done: number }>;
  routinesByGoal: Record<string, { id: string; title: string; weekday: number }[]>;
};

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Compute whether a goal is effectively overdue purely from its date — no DB write. */
function computeStatus(goal: Goal): "active" | "completed" | "overdue" {
  if (goal.status === "completed") return "completed";
  const today = new Date().toISOString().slice(0, 10);
  if (goal.target_date && goal.target_date < today) return "overdue";
  return "active";
}

function GoalsPage() {
  const fetchGoals = useServerFn(getGoals);
  const fetchWeek = useServerFn(getWeek);
  const saveFn = useServerFn(saveGoal);
  const delFn = useServerFn(deleteGoal);
  const addRoutineFn = useServerFn(addGoalRoutineTask);
  const removeRoutineBatchFn = useServerFn(removeGoalRoutineTasksBatch);
  const updateStatusFn = useServerFn(updateGoalStatus);
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const weekStart = toISODate(startOfWeek(new Date()));

  const { data, isLoading } = useQuery({
    queryKey: ["goals"],
    queryFn: () => fetchGoals({ data: undefined }) as Promise<GoalsResponse>,
  });

  // Fetch week so we can pass profile to AppShell
  const { data: weekData } = useQuery({
    queryKey: ["week", weekStart],
    queryFn: () => fetchWeek({ data: { weekStart } }) as Promise<WeekData>,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["goals"] });
    void qc.invalidateQueries({ queryKey: ["week"] });
  };

  const create = useMutation({
    mutationFn: (v: { title: string; description: string | null; targetDate: string | null }) =>
      saveFn({ data: v }),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setTargetDate("");
      invalidate();
      toast.success("Goal created!");
    },
    onError: () => toast.error("Couldn't create goal."),
  });

  const remove = useMutation({
    mutationFn: (v: { id: string }) => delFn({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.info("Goal deleted");
    },
    onError: () => toast.error("Couldn't delete goal."),
  });

  const addRoutine = useMutation({
    mutationFn: (v: { goalId: string; title: string; weekdays: number[] }) =>
      addRoutineFn({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("Repeating task linked to goal!");
    },
    onError: () => toast.error("Couldn't link task."),
  });

  const removeRoutineBatch = useMutation({
    mutationFn: (v: { ids: string[] }) => removeRoutineBatchFn({ data: v }),
    onSuccess: () => invalidate(),
    onError: () => toast.error("Couldn't remove linked task."),
  });

  const markStatus = useMutation({
    mutationFn: (v: {
      id: string;
      status: "active" | "completed" | "overdue";
      newTargetDate?: string | null;
    }) => updateStatusFn({ data: v }),
    onSuccess: (_data, vars) => {
      invalidate();
      if (vars.status === "completed") toast.success("🎉 Goal marked complete!");
      else if (vars.status === "active") toast.info("Goal reactivated.");
    },
    onError: () => toast.error("Couldn't update goal status."),
  });

  const goals = data?.goals ?? [];
  const stats = data?.stats ?? {};
  const routinesByGoal = data?.routinesByGoal ?? {};

  // Compute effective status client-side — no DB mutation on read
  const { activeGoals, overdueGoals, completedGoals } = useMemo(() => {
    const active: Goal[] = [];
    const overdue: Goal[] = [];
    const completed: Goal[] = [];
    for (const g of goals) {
      const s = computeStatus(g);
      if (s === "completed") completed.push(g);
      else if (s === "overdue") overdue.push(g);
      else active.push(g);
    }
    return { activeGoals: active, overdueGoals: overdue, completedGoals: completed };
  }, [goals]);

  return (
    <AppShell profile={weekData?.profile ?? null}>
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Long-term Goals</h1>
        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
          {goals.length} goal{goals.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Create goals, link repeating daily tasks, and track progress week by week until completion.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* New Goal Form */}
        <form
          className="h-fit space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm"
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
            Create New Goal
          </h2>
          <div className="space-y-2">
            <Label htmlFor="goal-title">Goal Title *</Label>
            <Input
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Run a 5K marathon"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-desc">Description (optional)</Label>
            <Textarea
              id="goal-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why this goal matters to you..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-target">Target Due Date</Label>
            <Input
              id="goal-target"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Goals past their due date are highlighted as overdue.
            </p>
          </div>
          <Button
            type="submit"
            className="w-full gap-2"
            disabled={create.isPending || !title.trim()}
          >
            {create.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create Goal
          </Button>
        </form>

        {/* Goals List */}
        <div className="space-y-5">
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading goals…</p>
          )}

          {!isLoading && goals.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <Target className="mx-auto h-10 w-10 text-muted-foreground opacity-40" />
              <p className="mt-3 text-sm font-medium">No goals yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create your first goal using the form on the left.
              </p>
            </div>
          )}

          {/* Overdue Goals (shown first) */}
          {overdueGoals.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h2 className="text-sm font-semibold text-destructive uppercase tracking-wider">
                  Overdue ({overdueGoals.length})
                </h2>
              </div>
              <div className="space-y-4">
                {overdueGoals.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    effectiveStatus="overdue"
                    stat={stats[g.id] ?? { total: 0, done: 0 }}
                    routines={routinesByGoal[g.id] ?? []}
                    onDelete={() => remove.mutate({ id: g.id })}
                    onMarkComplete={() =>
                      markStatus.mutate({ id: g.id, status: "completed" })
                    }
                    onExtendDate={(d) =>
                      markStatus.mutate({ id: g.id, status: "active", newTargetDate: d })
                    }
                    onAddRoutine={(t, weekdays) =>
                      addRoutine.mutate({ goalId: g.id, title: t, weekdays })
                    }
                    onRemoveRoutineGroup={(ids) => removeRoutineBatch.mutate({ ids })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Active Goals */}
          {activeGoals.length > 0 && (
            <div>
              {overdueGoals.length > 0 && (
                <div className="flex items-center gap-2 mb-3 mt-6">
                  <Zap className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                    Active ({activeGoals.length})
                  </h2>
                </div>
              )}
              <div className="space-y-4">
                {activeGoals.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    effectiveStatus="active"
                    stat={stats[g.id] ?? { total: 0, done: 0 }}
                    routines={routinesByGoal[g.id] ?? []}
                    onDelete={() => remove.mutate({ id: g.id })}
                    onMarkComplete={() =>
                      markStatus.mutate({ id: g.id, status: "completed" })
                    }
                    onExtendDate={(d) =>
                      markStatus.mutate({ id: g.id, status: "active", newTargetDate: d })
                    }
                    onAddRoutine={(t, weekdays) =>
                      addRoutine.mutate({ goalId: g.id, title: t, weekdays })
                    }
                    onRemoveRoutineGroup={(ids) => removeRoutineBatch.mutate({ ids })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Completed Goals */}
          {completedGoals.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Completed ({completedGoals.length})
                </h2>
              </div>
              <div className="space-y-3 opacity-70">
                {completedGoals.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    effectiveStatus="completed"
                    stat={stats[g.id] ?? { total: 0, done: 0 }}
                    routines={[]}
                    onDelete={() => remove.mutate({ id: g.id })}
                    onReopen={() => markStatus.mutate({ id: g.id, status: "active" })}
                    onMarkComplete={() => {}}
                    onExtendDate={() => {}}
                    onAddRoutine={() => {}}
                    onRemoveRoutineGroup={() => {}}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function GoalCard({
  goal,
  effectiveStatus,
  stat,
  routines,
  onDelete,
  onMarkComplete,
  onReopen,
  onExtendDate,
  onAddRoutine,
  onRemoveRoutineGroup,
}: {
  goal: Goal;
  effectiveStatus: "active" | "completed" | "overdue";
  stat: { total: number; done: number };
  routines: { id: string; title: string; weekday: number }[];
  onDelete: () => void;
  onMarkComplete: () => void;
  onReopen?: () => void;
  onExtendDate: (d: string) => void;
  onAddRoutine: (title: string, weekdays: number[]) => void;
  onRemoveRoutineGroup: (ids: string[]) => void;
}) {
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [showExtendPanel, setShowExtendPanel] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [extendDate, setExtendDate] = useState(goal.target_date ?? "");

  const pct = stat.total ? Math.round((stat.done / stat.total) * 100) : 0;
  const isOverdue = effectiveStatus === "overdue";
  const isCompleted = effectiveStatus === "completed";

  const today = new Date().toISOString().slice(0, 10);
  const daysUntilDue = goal.target_date
    ? Math.ceil(
        (new Date(goal.target_date).getTime() - new Date(today).getTime()) / 86400000,
      )
    : null;

  function toggleDay(d: number) {
    setSelectedDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  function submitRoutine() {
    if (!taskTitle.trim() || selectedDays.length === 0) return;
    onAddRoutine(taskTitle.trim(), selectedDays);
    setTaskTitle("");
    setShowLinkPanel(false);
  }

  // Group routines by title for display
  const routineGroups = Array.from(
    routines.reduce((map, rt) => {
      const key = rt.title;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(rt);
      return map;
    }, new Map<string, typeof routines>()),
  );

  return (
    <article
      className={`rounded-2xl border p-5 shadow-sm transition-all ${
        isOverdue
          ? "border-destructive/50 bg-destructive/5"
          : isCompleted
            ? "border-border/60 bg-card/60"
            : "border-border bg-card"
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className={`mt-1 shrink-0 ${
            isCompleted ? "text-primary" : isOverdue ? "text-destructive" : "text-primary"
          }`}
        >
          {isCompleted ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : isOverdue ? (
            <AlertTriangle className="h-5 w-5" />
          ) : (
            <Target className="h-5 w-5" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold tracking-tight text-base">{goal.title}</h3>
              {goal.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{goal.description}</p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`num text-sm font-bold ${
                  isCompleted ? "text-primary" : isOverdue ? "text-destructive" : "text-primary"
                }`}
              >
                {pct}%
              </span>

              {/* Delete with confirm */}
              {showDeleteConfirm ? (
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-destructive font-medium">Delete?</span>
                  <button
                    onClick={() => {
                      onDelete();
                      setShowDeleteConfirm(false);
                    }}
                    className="rounded-md bg-destructive px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-destructive/90 transition-colors"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  aria-label={`Delete ${goal.title}`}
                  className="text-muted-foreground hover:text-destructive p-1 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Due date badge */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {goal.target_date && (
              <span
                className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium ${
                  isOverdue
                    ? "bg-destructive/15 text-destructive"
                    : isCompleted
                      ? "bg-secondary text-muted-foreground"
                      : daysUntilDue !== null && daysUntilDue <= 7
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "bg-secondary text-muted-foreground"
                }`}
              >
                <Calendar className="h-3 w-3" />
                {isOverdue
                  ? `Overdue — due was ${formatDayDate(goal.target_date)}`
                  : isCompleted
                    ? `Completed · Due was ${formatDayDate(goal.target_date)}`
                    : daysUntilDue === 0
                      ? "Due today!"
                      : daysUntilDue === 1
                        ? "Due tomorrow"
                        : `Due ${formatDayDate(goal.target_date)} · ${daysUntilDue}d left`}
              </span>
            )}

            {routines.length > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-primary font-medium">
                <Repeat className="h-3 w-3" />
                {routines.length} repeating task{routines.length !== 1 ? "s" : ""}
              </span>
            )}

            {isCompleted && (
              <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-primary font-semibold">
                ✓ Completed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-4">
        <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isOverdue ? "bg-destructive/70" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="num mt-1.5 text-xs text-muted-foreground">
          {stat.done} / {stat.total} linked day-tasks completed
          {stat.total === 0 && routines.length > 0 && (
            <span className="ml-1 text-muted-foreground/70">
              (tasks appear once a linked week is loaded on the Tasks tab)
            </span>
          )}
        </p>
      </div>

      {/* Linked Repeating Tasks */}
      {routines.length > 0 && (
        <div className="mt-4 rounded-xl bg-secondary/30 p-3.5">
          <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Repeat className="h-3.5 w-3.5 text-primary" />
            Repeating Tasks Linked to this Goal
          </div>
          <div className="space-y-1.5">
            {routineGroups.map(([rtTitle, rts]) => (
              <div key={rtTitle} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-foreground">{rtTitle}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">
                    {rts.map((rt) => WEEKDAY_SHORT[rt.weekday]).join(", ")}
                  </span>
                  <button
                    onClick={() => onRemoveRoutineGroup(rts.map((rt) => rt.id))}
                    className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                    aria-label={`Remove ${rtTitle}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {!isCompleted && (
        <div className="mt-4 flex flex-wrap gap-2">
          {/* Link repeating task */}
          <button
            onClick={() => {
              setShowLinkPanel((v) => !v);
              setShowExtendPanel(false);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              showLinkPanel
                ? "bg-primary/20 text-primary"
                : "bg-secondary/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            {showLinkPanel ? "Hide task panel" : "Link Repeating Task"}
            {showLinkPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {/* Mark Complete */}
          <button
            onClick={onMarkComplete}
            className="flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            Mark Complete
          </button>

          {/* Extend deadline (for overdue) */}
          {isOverdue && (
            <button
              onClick={() => {
                setShowExtendPanel((v) => !v);
                setShowLinkPanel(false);
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                showExtendPanel
                  ? "bg-amber-500/20 text-amber-600"
                  : "bg-secondary/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              Extend Deadline
              {showExtendPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      )}

      {isCompleted && onReopen && (
        <div className="mt-3">
          <button
            onClick={onReopen}
            className="flex items-center gap-1.5 rounded-lg bg-secondary/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reopen Goal
          </button>
        </div>
      )}

      {/* Link Repeating Task Panel */}
      {showLinkPanel && (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-primary mb-3 flex items-center gap-1.5">
            <Repeat className="h-3.5 w-3.5" />
            Link a Repeating Daily Task
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            This task will auto-appear every week on the selected days and count toward this
            goal's progress until it's completed.
          </p>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Task Name</Label>
              <Input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder={`e.g. "Train for 5K" or "Study 1hr"`}
                className="mt-1 h-9 text-sm"
              />
            </div>

            <div>
              <Label className="text-xs mb-1.5 block">Repeat on Days</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_SHORT.map((day, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                      selectedDays.includes(i)
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {day}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDays(selectedDays.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6])
                  }
                  className="rounded-lg bg-secondary/70 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {selectedDays.length === 7 ? "Clear all" : "Every day"}
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={submitRoutine}
                disabled={!taskTitle.trim() || selectedDays.length === 0}
                className="gap-1.5 h-8 px-3 text-xs"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                Link Task
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowLinkPanel(false)}
                className="h-8 px-3 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Deadline Panel */}
      {showExtendPanel && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-3 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            Extend Goal Deadline
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            Pick a new target date. The goal will be marked active and repeating tasks will resume.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={extendDate}
              onChange={(e) => setExtendDate(e.target.value)}
              className="h-9 text-sm flex-1"
              min={new Date().toISOString().slice(0, 10)}
            />
            <Button
              size="sm"
              onClick={() => {
                if (extendDate) {
                  onExtendDate(extendDate);
                  setShowExtendPanel(false);
                }
              }}
              disabled={!extendDate}
              className="h-9 px-3 text-xs gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Extend
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowExtendPanel(false)}
              className="h-9 px-3 text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

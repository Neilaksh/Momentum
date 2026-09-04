import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flame,
  LinkIcon,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Snowflake,
  Sparkles,
  Target,
  Trash2,
  Unlink,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { ProgressRing } from "@/components/ProgressRing";
import { SubjectSelect, SubjectTag, useSubjects } from "@/components/SubjectSelect";
import type { Subject as SubjectType } from "@/lib/subjects-shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addDayTask,
  deleteGoal,
  getGoalWeeklyProgress,
  getGoals,
  renameGoal,
  removeGoalRoutineTasksBatch,
  saveGoal,
  toggleDayTask,
  updateGoalStatus,
} from "@/lib/tracker.functions";
import { getHabits, linkHabitToGoal, updateHabitTrackingDuration, unlinkHabitFromGoal } from "@/lib/habits.functions";
import { parseHabitTitle, type HabitsData } from "@/lib/habits-shared";
import { getWeek } from "@/lib/tracker.functions";
import {
  addDays,
  buildRolloverChains,
  formatDayDate,
  formatGoalTitle,
  parseGoalTitle,
  parseISODate,
  parseRoutineTitle,
  startOfWeek,
  toISODate,
  type DayTask,
  type Goal,
  type GoalHabitSnapshot,
  type GoalPriority,
  type GoalProgress,
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
  tasksByGoal?: Record<string, DayTask[]>;
  progressByGoal: Record<string, GoalProgress>;
  snapshotsByGoal: Record<string, GoalHabitSnapshot[]>;
  habitIdsByGoal: Record<string, string[]>;
  habitDurationsByGoal: Record<
    string,
    Record<string, { durationDays: number | null; createdAt: string }>
  >;
};

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Compute whether a goal is effectively overdue purely from its date — no DB write. */
function computeStatus(goal: Goal): "active" | "completed" | "overdue" {
  if (goal.status === "completed") return "completed";
  const today = new Date().toISOString().slice(0, 10);
  if (goal.target_date && goal.target_date < today) return "overdue";
  return "active";
}

/**
 * Display-only rollover-chain collapsing for the Goal Tasks list.
 *
 * Chains come from the shared buildRolloverChains() (same rules as the
 * server's superseded detection). Each multi-row chain renders as ONE row:
 * the original (its original task_date, which never changes), with the
 * chain's current completion status mirrored onto it. The original's
 * rollover_count is >= 1 (the rollover pass stamps the source row), so the
 * existing "Completed late" badge shows whenever the chain has been
 * completed. This is display-only: the underlying day_tasks rows, rollover
 * logic, and the goal progress counting math are untouched, and the Tasks
 * page keeps rendering the actual active copy.
 */
function collapseRolloverChains(tasks: DayTask[]): DayTask[] {
  if (tasks.length < 2) return tasks;

  const out: DayTask[] = [];
  for (const members of buildRolloverChains(tasks)) {
    if (members.length === 1) {
      out.push(members[0]!);
      continue;
    }
    let newest = members[0]!;
    for (const m of members) {
      if (m.task_date > newest.task_date) newest = m;
    }
    // Mirror the chain's status: only the newest copy can ever be completed
    // (older rows are locked), so the latest completed member wins.
    let completed: DayTask | null = null;
    for (const m of members) {
      if (m.completed_at && (!completed || m.task_date >= completed.task_date)) completed = m;
    }
    out.push(completed ? { ...newest, completed_at: completed.completed_at } : newest);
  }
  return out;
}

function GoalsPage() {
  const fetchGoals = useServerFn(getGoals);
  const fetchWeek = useServerFn(getWeek);
  const fetchHabits = useServerFn(getHabits);
  const saveFn = useServerFn(saveGoal);
  const delFn = useServerFn(deleteGoal);
  const removeRoutineBatchFn = useServerFn(removeGoalRoutineTasksBatch);
  const updateStatusFn = useServerFn(updateGoalStatus);
  const toggleTaskFn = useServerFn(toggleDayTask);
  const addTaskFn = useServerFn(addDayTask);
  const linkHabitFn = useServerFn(linkHabitToGoal);
  const unlinkHabitFn = useServerFn(unlinkHabitFromGoal);
  const setDurationFn = useServerFn(updateHabitTrackingDuration);
  const qc = useQueryClient();
  const { subjects, subjectsMap } = useSubjects();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [priority, setPriority] = useState<GoalPriority | null>(null);
  const [sortBy, setSortBy] = useState<"default" | "priority" | "progress" | "due">("default");

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

  const { data: habitsData } = useQuery({
    queryKey: ["habits", weekStart],
    queryFn: () => fetchHabits({ data: { weekStart } }) as Promise<HabitsData>,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["goals"] });
    void qc.invalidateQueries({ queryKey: ["week"] });
    void qc.invalidateQueries({ queryKey: ["habits"] });
  };

  const create = useMutation({
    mutationFn: (v: { title: string; description: string | null; targetDate: string | null }) =>
      saveFn({ data: v }),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setTargetDate("");
      setPriority(null);
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

  const renameFn = useServerFn(renameGoal);
  const rename = useMutation({
    mutationFn: (v: { id: string; title: string }) => renameFn({ data: v }),
    onSuccess: (_res, v) => {
      invalidate();
      toast.success(`Goal renamed to “${v.title.trim()}”`);
    },
    onError: () => toast.error("Couldn't rename goal — try again."),
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
      else if (vars.status === "active" && vars.newTargetDate !== undefined) {
        if (vars.newTargetDate) toast.success("Deadline updated.");
        else toast.info("Deadline cleared.");
      } else if (vars.status === "active") toast.info("Goal reactivated.");
    },
    onError: () => toast.error("Couldn't update goal status."),
  });

  const toggleTask = useMutation({
    mutationFn: (v: { id: string; completed: boolean }) => toggleTaskFn({ data: v }),
    onSuccess: () => invalidate(),
    onError: () => toast.error("Couldn't update task."),
  });

  const addDirectGoalTask = useMutation({
    mutationFn: (v: { goalId: string; title: string; date: string; subjectId?: string | null }) =>
      addTaskFn({ data: { title: v.title, goalId: v.goalId, date: v.date, subjectId: v.subjectId ?? null } }),
    onSuccess: () => {
      invalidate();
      toast.success("Task added to goal for today");
    },
    onError: () => toast.error("Couldn't add task."),
  });

  const scheduleGoalTask = useMutation({
    mutationFn: (v: { goalId: string; title: string; date: string; subjectId?: string | null }) =>
      addTaskFn({ data: { title: v.title, goalId: v.goalId, date: v.date, subjectId: v.subjectId ?? null } }),
    onSuccess: (_data, vars) => {
      invalidate();
      toast.success(`Task scheduled for ${formatDayDate(vars.date)}`);
    },
    onError: () => toast.error("Couldn't schedule task."),
  });

  const linkHabit = useMutation({
    mutationFn: (v: { habitId: string; goalId: string }) => linkHabitFn({ data: v }),
    onSuccess: () => { invalidate(); toast.success("Habit linked to goal!"); },
    onError: () => toast.error("Couldn't link habit."),
  });

  const unlinkHabit = useMutation({
    mutationFn: (v: { goalId: string; habitId: string }) => unlinkHabitFn({ data: v }),
    onSuccess: () => { invalidate(); toast.success("Habit unlinked."); },
    onError: () => toast.error("Couldn't unlink habit."),
  });

  const setHabitDuration = useMutation({
    mutationFn: (v: { goalId: string; habitId: string; durationDays: number | null }) =>
      setDurationFn({ data: v }),
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't update the tracking duration."),
  });

  const goals = data?.goals ?? [];
  const stats = data?.stats ?? {};
  const routinesByGoal = data?.routinesByGoal ?? {};
  const tasksByGoal = data?.tasksByGoal ?? {};
  const progressByGoal = data?.progressByGoal ?? {};
  const snapshotsByGoal = data?.snapshotsByGoal ?? {};
  const habitIdsByGoal = data?.habitIdsByGoal ?? {};
  const habitDurationsByGoal = data?.habitDurationsByGoal ?? {};
  const allHabitStats = habitsData?.stats ?? [];

  // Compute effective status client-side — no DB mutation on read
  const { activeGoals, overdueGoals, completedGoals } = useMemo(() => {
    let active: Goal[] = [];
    let overdue: Goal[] = [];
    let completed: Goal[] = [];
    for (const g of goals) {
      const s = computeStatus(g);
      if (s === "completed") completed.push(g);
      else if (s === "overdue") overdue.push(g);
      else active.push(g);
    }

    const priorityRank = (g: Goal) => {
      const p = parseGoalTitle(g.title).priority;
      if (p === "High") return 3;
      if (p === "Med") return 2;
      if (p === "Low") return 1;
      return 0;
    };

    if (sortBy === "priority") {
      active.sort((a, b) => priorityRank(b) - priorityRank(a));
      overdue.sort((a, b) => priorityRank(b) - priorityRank(a));
    } else if (sortBy === "progress") {
      active.sort((a, b) => (progressByGoal[b.id]?.overall ?? 0) - (progressByGoal[a.id]?.overall ?? 0));
      overdue.sort((a, b) => (progressByGoal[b.id]?.overall ?? 0) - (progressByGoal[a.id]?.overall ?? 0));
    } else if (sortBy === "due") {
      active.sort((a, b) => (a.target_date ?? "9999-99-99").localeCompare(b.target_date ?? "9999-99-99"));
      overdue.sort((a, b) => (a.target_date ?? "9999-99-99").localeCompare(b.target_date ?? "9999-99-99"));
    }

    return { activeGoals: active, overdueGoals: overdue, completedGoals: completed };
  }, [goals, sortBy, progressByGoal]);

  const recommendedGoal = useMemo(() => {
    const uncompleted = [...overdueGoals, ...activeGoals];
    if (uncompleted.length === 0) return null;
    return uncompleted.sort((a, b) => {
      const progA = progressByGoal[a.id]?.overall ?? 0;
      const progB = progressByGoal[b.id]?.overall ?? 0;
      const dateA = a.target_date ?? "9999-99-99";
      const dateB = b.target_date ?? "9999-99-99";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return progA - progB;
    })[0];
  }, [overdueGoals, activeGoals, progressByGoal]);

  return (
    <AppShell profile={weekData?.profile ?? null}>
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Long-term Goals</h1>
        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
          {goals.length} goal{goals.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Create goals, schedule tasks on any day (optionally repeating for several days), and track
        progress until completion.
      </p>

      {/* Next-Goal Recommendation Highlight */}
      {recommendedGoal && (
        <div className="mt-6 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 via-card to-card p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  Recommended Focus Goal
                </span>
                {recommendedGoal.target_date && (
                  <span className="text-xs text-muted-foreground">
                    Due {formatDayDate(recommendedGoal.target_date)}
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-foreground mt-0.5 truncate">
                {recommendedGoal.title}
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-xs font-semibold text-primary">
                {progressByGoal[recommendedGoal.id]?.overall ?? 0}% complete
              </span>
              <p className="text-[10px] text-muted-foreground">
                {progressByGoal[recommendedGoal.id]?.taskDone ?? 0}/{progressByGoal[recommendedGoal.id]?.taskTotal ?? 0} tasks done
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* New Goal Form */}
        <form
          className="h-fit space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"
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
          <h2 className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">
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
          {/* Priority Level */}
          <div className="space-y-1.5">
            <Label>Priority Level</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { val: null, label: "None" },
                { val: "Low" as const, label: "🟢 Low" },
                { val: "Med" as const, label: "🟡 Med" },
                { val: "High" as const, label: "🔴 High" },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setPriority(opt.val)}
                  className={`rounded-lg py-1.5 text-xs font-semibold transition-all border ${
                    priority === opt.val
                      ? "border-primary bg-primary/20 text-foreground shadow-xs"
                      : "border-border/70 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <Button
            type="submit"
            className="w-full gap-2"
            disabled={create.isPending || !title.trim()}
            onClick={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              create.mutate({
                title: formatGoalTitle(title.trim(), priority),
                description: description.trim() || null,
                targetDate: targetDate || null,
              });
            }}
          >
            {create.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create Goal
          </Button>
        </form>

        {/* Goals List with Sort Controls */}
        <div className="min-w-0 space-y-5">
          {goals.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sort Goals By:
              </span>
              <div className="flex w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-secondary/40 p-1 text-xs [scrollbar-width:none] sm:w-auto [&::-webkit-scrollbar]:hidden">
                {[
                  { id: "default", label: "Default" },
                  { id: "priority", label: "🔴 Priority" },
                  { id: "progress", label: "⚡ Progress" },
                  { id: "due", label: "📅 Due Date" },
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSortBy(s.id as any)}
                    className={`whitespace-nowrap rounded-md px-2.5 py-1 transition-colors ${
                      sortBy === s.id
                        ? "bg-card font-medium text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
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
                <h2 className="text-xs font-semibold text-destructive uppercase tracking-wider">
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
                    progress={progressByGoal[g.id]}
                    routines={routinesByGoal[g.id] ?? []}
                    tasks={tasksByGoal[g.id] ?? []}
                    subjects={subjects}
                    subjectsMap={subjectsMap}
                    allHabitStats={allHabitStats}
                    habitSnapshots={snapshotsByGoal[g.id] ?? []}
                    goalHabitIds={new Set(habitIdsByGoal[g.id] ?? [])}
                    habitDurations={habitDurationsByGoal[g.id] ?? {}}
                    onDelete={() => remove.mutate({ id: g.id })}
                    onRename={(title) => rename.mutate({ id: g.id, title })}
                    onMarkComplete={() => markStatus.mutate({ id: g.id, status: "completed" })}
                    onExtendDate={(d) => markStatus.mutate({ id: g.id, status: "active", newTargetDate: d || null })}
                    onRemoveRoutineGroup={(ids) => removeRoutineBatch.mutate({ ids })}
                    onToggleTask={(id, completed) => toggleTask.mutate({ id, completed })}
                    onAddDirectTask={(t, subjectId) => addDirectGoalTask.mutate({ goalId: g.id, title: t, date: toISODate(new Date()), subjectId })}
                    onScheduleTask={(v) => scheduleGoalTask.mutate({ goalId: g.id, title: v.title, date: v.date, subjectId: v.subjectId })}
                    onLinkHabit={(habitId) => linkHabit.mutate({ habitId, goalId: g.id })}
                    onUnlinkHabit={(habitId) => unlinkHabit.mutate({ habitId, goalId: g.id })}
                    onSetDuration={(habitId, durationDays) => setHabitDuration.mutate({ goalId: g.id, habitId, durationDays })}
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
                  <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
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
                    progress={progressByGoal[g.id]}
                    routines={routinesByGoal[g.id] ?? []}
                    tasks={tasksByGoal[g.id] ?? []}
                    subjects={subjects}
                    subjectsMap={subjectsMap}
                    allHabitStats={allHabitStats}
                    habitSnapshots={snapshotsByGoal[g.id] ?? []}
                    goalHabitIds={new Set(habitIdsByGoal[g.id] ?? [])}
                    habitDurations={habitDurationsByGoal[g.id] ?? {}}
                    onDelete={() => remove.mutate({ id: g.id })}
                    onRename={(title) => rename.mutate({ id: g.id, title })}
                    onMarkComplete={() => markStatus.mutate({ id: g.id, status: "completed" })}
                    onExtendDate={(d) => markStatus.mutate({ id: g.id, status: "active", newTargetDate: d || null })}
                    onRemoveRoutineGroup={(ids) => removeRoutineBatch.mutate({ ids })}
                    onToggleTask={(id, completed) => toggleTask.mutate({ id, completed })}
                    onAddDirectTask={(t, subjectId) => addDirectGoalTask.mutate({ goalId: g.id, title: t, date: toISODate(new Date()), subjectId })}
                    onScheduleTask={(v) => scheduleGoalTask.mutate({ goalId: g.id, title: v.title, date: v.date, subjectId: v.subjectId })}
                    onLinkHabit={(habitId) => linkHabit.mutate({ habitId, goalId: g.id })}
                    onUnlinkHabit={(habitId) => unlinkHabit.mutate({ habitId, goalId: g.id })}
                    onSetDuration={(habitId, durationDays) => setHabitDuration.mutate({ goalId: g.id, habitId, durationDays })}
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
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                    progress={progressByGoal[g.id]}
                    routines={[]}
                    tasks={tasksByGoal[g.id] ?? []}
                    subjects={subjects}
                    subjectsMap={subjectsMap}
                    allHabitStats={allHabitStats}
                    habitSnapshots={snapshotsByGoal[g.id] ?? []}
                    goalHabitIds={new Set(habitIdsByGoal[g.id] ?? [])}
                    habitDurations={habitDurationsByGoal[g.id] ?? {}}
                    onDelete={() => remove.mutate({ id: g.id })}
                    onRename={() => {}}
                    onReopen={() => markStatus.mutate({ id: g.id, status: "active" })}
                    onMarkComplete={() => {}}
                    onExtendDate={() => {}}
                    onRemoveRoutineGroup={() => {}}
                    onToggleTask={(id, completed) => toggleTask.mutate({ id, completed })}
                    onAddDirectTask={() => {}}
                    onLinkHabit={() => {}}
                    onUnlinkHabit={() => {}}
                    onSetDuration={() => {}}
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

/**
 * Set / edit / clear the per-link tracking duration for one (goal, habit) pair.
 * Writes only to goal_habit_links.duration_days for that pair — the habit's
 * weekly target, logging, and its links to other goals are untouched.
 */
function HabitDurationControl({
  durationDays,
  trackedFrom,
  canEdit,
  onSet,
}: {
  durationDays: number | null;
  trackedFrom: string;
  canEdit: boolean;
  onSet: (durationDays: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const trackedFromDay = trackedFrom ? parseISODate(trackedFrom.slice(0, 10)) : null;
  // Last tracked day = link created_at + duration_days - 1 (duration_days days
  // starting from the link's created_at).
  const endDate =
    durationDays != null && trackedFromDay
      ? formatDayDate(toISODate(addDays(trackedFromDay, durationDays - 1)))
      : null;
  const parsed = Number.parseInt(draft, 10);
  const draftValid =
    draft.trim() === "" || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 3650);

  if (!editing) {
    if (endDate) {
      return (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-400"
            title="Tracking duration for this goal"
          >
            <CalendarClock className="h-2.5 w-2.5" />
            Tracked until {endDate}
          </span>
          {canEdit && (
            <>
              <button
                onClick={() => {
                  setDraft(String(durationDays));
                  setEditing(true);
                }}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-2 -mx-1 -my-1 md:px-1.5 md:py-0.5 md:mx-0 md:my-0 transition-colors"
                aria-label="Edit tracking duration"
              >
                Edit
              </button>
              <button
                onClick={() => onSet(null)}
                className="text-[11px] font-medium text-muted-foreground hover:text-destructive px-2.5 py-2 -mx-1 -my-1 md:px-1.5 md:py-0.5 md:mx-0 md:my-0 transition-colors"
                aria-label="Clear tracking duration"
              >
                Clear
              </button>
            </>
          )}
        </div>
      );
    }
    if (canEdit) {
      return (
        <button
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="mt-0.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground px-2.5 py-2 -mx-1 -my-1 md:px-1.5 md:py-0.5 md:mx-0 md:my-0 transition-colors"
          aria-label="Set tracking duration"
        >
          + Set duration
        </button>
      );
    }
    return null;
  }

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        max={3650}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="days"
        aria-label="Tracking duration in days"
        className="h-6 w-16 rounded-md border border-border bg-secondary/50 px-1.5 text-[10px] num text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        disabled={!draftValid}
        onClick={() => {
          const trimmed = draft.trim();
          onSet(trimmed === "" ? null : Number.parseInt(trimmed, 10));
          setEditing(false);
        }}
        className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-2 -mx-1 -my-1 md:px-1.5 md:py-0.5 md:mx-0 md:my-0 text-[11px] font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
      >
        Save
      </button>
      <button
        onClick={() => setEditing(false)}
        className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-2 -mx-1 -my-1 md:px-1.5 md:py-0.5 md:mx-0 md:my-0 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

function GoalCard({
  goal,
  effectiveStatus,
  stat,
  progress,
  routines,
  tasks,
  subjects,
  subjectsMap,
  allHabitStats,
  habitSnapshots,
  onDelete,
  onRename,
  onMarkComplete,
  onReopen,
  onExtendDate,
  onRemoveRoutineGroup,
  onToggleTask,
  onAddDirectTask,
  onScheduleTask,
  onLinkHabit,
  onUnlinkHabit,
  goalHabitIds,
  habitDurations,
  onSetDuration,
}: {
  goal: Goal;
  effectiveStatus: "active" | "completed" | "overdue";
  stat: { total: number; done: number };
  progress: GoalProgress | undefined;
  routines: { id: string; title: string; weekday: number }[];
  tasks: DayTask[];
  subjects: SubjectType[];
  subjectsMap: Map<string, SubjectType>;
  allHabitStats: HabitsData["stats"];
  habitSnapshots: GoalHabitSnapshot[];
  onDelete: () => void;
  onRename: (title: string) => void;
  onMarkComplete: () => void;
  onReopen?: () => void;
  onExtendDate: (d: string) => void;
  onRemoveRoutineGroup: (ids: string[]) => void;
  onToggleTask: (id: string, completed: boolean) => void;
  onAddDirectTask: (title: string, subjectId: string | null) => void;
  onScheduleTask?: (v: { title: string; date: string; subjectId: string | null }) => void;
  onLinkHabit: (habitId: string) => void;
  onUnlinkHabit: (habitId: string) => void;
  goalHabitIds: Set<string>;
  habitDurations: Record<string, { durationDays: number | null; createdAt: string }>;
  onSetDuration: (habitId: string, durationDays: number | null) => void;
}) {
  const [showLinkHabitDropdown, setShowLinkHabitDropdown] = useState(false);
  const [showExtendPanel, setShowExtendPanel] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showProgressDetails, setShowProgressDetails] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [inlineTask, setInlineTask] = useState("");
  const [inlineSubjectId, setInlineSubjectId] = useState<string | null>(null);
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleSubjectId, setScheduleSubjectId] = useState<string | null>(null);
  const [extendDate, setExtendDate] = useState(goal.target_date ?? "");

  const parsedGoal = useMemo(() => parseGoalTitle(goal.title), [goal.title]);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePriority, setRenamePriority] = useState<GoalPriority | null>(parsedGoal.priority);

  const fetchGoalWeekly = useServerFn(getGoalWeeklyProgress);
  const { data: trailData, isLoading: isTrailLoading } = useQuery({
    queryKey: ["goal-weekly-progress", goal.id],
    queryFn: () =>
      fetchGoalWeekly({ data: { goalId: goal.id } }) as Promise<{
        weeks: { weekStart: string; done: number; total: number }[];
      }>,
    enabled: showProgressDetails,
  });
  const trailWeeks = trailData?.weeks ?? [];

  const submitRename = () => {
    const clean = renameDraft.trim();
    if (!clean) {
      setShowRenameModal(false);
      return;
    }
    const formatted = formatGoalTitle(clean, renamePriority);
    if (formatted === goal.title.trim()) {
      setShowRenameModal(false);
      return;
    }
    onRename(formatted);
    setShowRenameModal(false);
  };

  const isOverdue = effectiveStatus === "overdue";
  const isCompleted = effectiveStatus === "completed";
  // Frozen habit stats: on a completed goal, a snapshot (if one exists at the
  // completion moment) replaces the live, still-moving weekly hit-rate for
  // that habit. Active/overdue goals always show live stats.
  const snapFor = (habitId: string) =>
    isCompleted ? habitSnapshots.find((h) => h.habitId === habitId) : undefined;
  const overall = progress?.overall ?? null;
  const taskScore = progress?.taskScore ?? null;
  const habitScore = progress?.habitScore ?? null;
  // Single source of truth for every % shown on this card: progress.overall.
  // For a completed goal getGoals already recomputes overall from the frozen
  // per-habit snapshots (the "Frozen" treatment), so hardcoding 100% here
  // made the header badge / ring fill disagree with the ring's numeric label
  // whenever that recomputed value is < 100 (e.g. a habit linked after
  // completion whose live hit-rate is below 100%).
  const barPct = overall ?? 0;

  const today = new Date().toISOString().slice(0, 10);
  const daysUntilDue = goal.target_date
    ? Math.ceil(
        (new Date(goal.target_date).getTime() - new Date(today).getTime()) / 86400000,
      )
    : null;

  const routineGroups = Array.from(
    routines.reduce((map, rt) => {
      const parsed = parseRoutineTitle(rt.title);
      const key = parsed.displayTitle || rt.title;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(rt);
      return map;
    }, new Map<string, typeof routines>()),
  );

  // Rollover chains collapse to a single row (the original) for this list only —
  // display-only, the counting math in progress/progressByGoal is unaffected.
  const displayTasks = collapseRolloverChains(tasks);
  const pendingTasks = displayTasks.filter((t) => !t.completed_at && t.task_date <= today);
  const activeTasks = displayTasks.filter((t) => !(t.task_date > today && !t.completed_at));
  const upcomingTasks = displayTasks
    .filter((t) => !t.completed_at && t.task_date > today)
    .sort((a, b) => a.task_date.localeCompare(b.task_date));

  // Rollover chain resilience metrics across all tasks linked to this goal
  const rolloverMetrics = useMemo(() => {
    const chains = buildRolloverChains(tasks);
    const rolloverChains = chains.filter(
      (c) => c.length > 1 || (c[0]?.rollover_count ?? 0) > 0,
    );
    const completedAfterRollover = rolloverChains.filter((c) =>
      c.some((t) => !!t.completed_at),
    ).length;
    const activeRollovers = rolloverChains.filter(
      (c) => !c.some((t) => !!t.completed_at),
    ).length;
    return {
      totalRolloverChains: rolloverChains.length,
      completedAfterRollover,
      activeRollovers,
    };
  }, [tasks]);

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
            isCompleted ? "text-emerald-400" : isOverdue ? "text-destructive" : "text-primary"
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
              <div className="flex items-center gap-1">
                <h3 className="font-semibold tracking-tight text-base">{parsedGoal.cleanTitle}</h3>
                <button
                  disabled={isCompleted}
                  onClick={() => {
                    setRenameDraft(parsedGoal.cleanTitle);
                    setRenamePriority(parsedGoal.priority);
                    setShowRenameModal(true);
                  }}
                  aria-label={
                    isCompleted
                      ? "Completed goals are locked and cannot be renamed"
                      : `Rename goal ${parsedGoal.cleanTitle}`
                  }
                  title={isCompleted ? "Completed goals are locked" : "Rename goal"}
                  className={`p-3 -m-2 md:p-1 md:m-0 transition-colors ${
                    isCompleted
                      ? "cursor-not-allowed text-muted-foreground/40"
                      : "text-muted-foreground hover:text-primary"
                  }`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
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
                {overall === null ? "—" : `${barPct}%`}
              </span>

              {/* Delete with confirm */}
              <button
                onClick={() => setShowDeleteConfirm(true)}
                aria-label={`Delete ${parsedGoal.cleanTitle}`}
                className="text-muted-foreground hover:text-destructive p-3 -m-2 md:p-1 md:m-0 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Badges row */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {parsedGoal.priority && (
              <span
                className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold text-xs ${
                  parsedGoal.priority === "High"
                    ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                    : parsedGoal.priority === "Med"
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                      : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                }`}
              >
                {parsedGoal.priority === "High"
                  ? "🔴 High Priority"
                  : parsedGoal.priority === "Med"
                    ? "🟡 Medium Priority"
                    : "🟢 Low Priority"}
              </span>
            )}

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

            {!isCompleted && (
              <span className="flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] text-muted-foreground font-medium">
                <RefreshCw className="h-2.5 w-2.5 text-primary" />
                Auto-shifts uncompleted tasks to next day
              </span>
            )}

            {rolloverMetrics.totalRolloverChains > 0 && (
              <span
                className="flex items-center gap-1 rounded-full bg-indigo-500/10 border border-indigo-500/25 px-2.5 py-0.5 text-xs text-indigo-400 font-medium"
                title={`${rolloverMetrics.completedAfterRollover} completed after rolling over, ${rolloverMetrics.activeRollovers} actively carried forward`}
              >
                <RefreshCw className="h-3 w-3" />
                {rolloverMetrics.completedAfterRollover > 0
                  ? `${rolloverMetrics.completedAfterRollover} done post-rollover`
                  : `${rolloverMetrics.totalRolloverChains} rolled over`}
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

      {/* Progress overview */}
      <div className="mt-4 rounded-xl bg-secondary/25 p-3.5">
        <div className="flex items-center gap-4">
          <ProgressRing
            value={barPct}
            size={68}
            stroke={7}
            label={overall === null ? "—" : `${overall}%`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Overall Progress
              </span>
              <span className="num text-sm font-bold">
                {overall === null ? "No tasks or habits yet" : `${overall}%`}
              </span>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
              {progress
                ? [
                    progress.hasTasks
                      ? `${progress.taskDone}/${progress.taskTotal} tasks`
                      : "no tasks",
                    progress.hasHabits
                      ? `${progress.habitsOnTrack}/${progress.habitsTotal} habits on track`
                      : "no habits",
                  ].join(" · ")
                : `${stat.done}/${stat.total} tasks · 0 habits`}
            </p>

            {(taskScore !== null || habitScore !== null) && (
              <div className="mt-2.5 space-y-1.5">
                {taskScore !== null && (
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Tasks
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${taskScore}%` }}
                      />
                    </div>
                    <span className="num w-9 shrink-0 text-right text-[10px] text-muted-foreground">
                      {taskScore}%
                    </span>
                  </div>
                )}
                {habitScore !== null && (
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Habits
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-amber-400 transition-all"
                        style={{ width: `${habitScore}%` }}
                      />
                    </div>
                    <span className="num w-9 shrink-0 text-right text-[10px] text-muted-foreground">
                      {habitScore}%
                    </span>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => setShowProgressDetails((v) => !v)}
              className="mt-2.5 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              {showProgressDetails ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {showProgressDetails ? "Hide progress details" : "Show progress details"}
            </button>
          </div>
        </div>

        {showProgressDetails && (
          <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {goal.target_date
                ? daysUntilDue === 0
                  ? "Due today!"
                  : daysUntilDue === 1
                    ? "Due tomorrow · 1 day left"
                    : daysUntilDue !== null && daysUntilDue > 0
                      ? `Due ${formatDayDate(goal.target_date)} · ${daysUntilDue} days left`
                      : `Overdue by ${Math.abs(daysUntilDue ?? 0)} ${Math.abs(daysUntilDue ?? 0) === 1 ? "day" : "days"}`
                : "No deadline"}
            </div>

            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
              <div className="rounded-lg bg-secondary/40 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tasks</p>
                <p className="num mt-0.5 text-sm font-bold">
                  {taskScore !== null ? `${taskScore}%` : "—"}
                </p>
                <p className="num text-[10px] text-muted-foreground">
                  {progress ? `${progress.taskDone}/${progress.taskTotal} done` : "no tasks"}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/40 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Habits</p>
                <p className="num mt-0.5 text-sm font-bold">
                  {habitScore !== null ? `${habitScore}%` : "—"}
                </p>
                <p className="num text-[10px] text-muted-foreground">
                  {progress
                    ? `${progress.habitsOnTrack}/${progress.habitsTotal} on track`
                    : "no habits"}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/40 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Overall</p>
                <p className="num mt-0.5 text-sm font-bold">
                  {overall === null ? "—" : `${overall}%`}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {overall === null
                    ? "No tasks or habits yet"
                    : overall >= 100
                      ? "Goal complete"
                      : "Goal in progress"}
                </p>
              </div>
              {rolloverMetrics.totalRolloverChains > 0 ? (
                <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">
                    Rollover Resilience
                  </p>
                  <p className="num mt-0.5 text-sm font-bold text-indigo-300">
                    {rolloverMetrics.completedAfterRollover}/{rolloverMetrics.totalRolloverChains} completed
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {rolloverMetrics.activeRollovers > 0
                      ? `${rolloverMetrics.activeRollovers} in-flight`
                      : "All finished"}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg bg-secondary/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Rollovers
                  </p>
                  <p className="num mt-0.5 text-sm font-bold">0</p>
                  <p className="text-[10px] text-muted-foreground">All done on schedule</p>
                </div>
              )}
            </div>

            {progress && progress.linkedHabits.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Habit weekly hit-rate (since link)
                </p>
                <ul className="space-y-1">
                  {progress.linkedHabits.map((lh) => {
                    const isDurationMode = lh.durationDays != null;
                    const onTrack = isDurationMode
                      ? lh.daysLogged === lh.durationDays
                      : lh.weeksMet === lh.weeksTotal;
                    return (
                      <li key={lh.habitId} className="flex items-center gap-2 text-xs">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${onTrack ? "bg-primary" : "bg-amber-400"}`} />
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          {lh.title}
                        </span>
                        <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full rounded-full ${onTrack ? "bg-primary" : "bg-amber-400"}`}
                            style={{ width: `${lh.hitRate}%` }}
                          />
                        </div>
                        <span className="num shrink-0 text-[11px] text-muted-foreground">
                          {isDurationMode ? `${lh.daysLogged}/${lh.durationDays} days` : `${lh.weeksMet}/${lh.weeksTotal} wks`} · {lh.hitRate}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Goal History Trail (Weekly Activity) */}
            <div className="rounded-xl border border-border/70 bg-secondary/20 p-3.5 mt-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Goal History Trail
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {trailWeeks.length} {trailWeeks.length === 1 ? "week" : "weeks"} tracked
                </span>
              </div>

              {isTrailLoading ? (
                <p className="text-xs text-muted-foreground py-1">Loading weekly trail...</p>
              ) : trailWeeks.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">
                  No weekly task history yet for this goal. As you complete linked daily tasks, weekly completion snapshots will appear here.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-2">
                  {trailWeeks.map((tw) => {
                    const pct = tw.total > 0 ? Math.round((tw.done / tw.total) * 100) : 0;
                    const isOnTrack = pct >= 80;
                    const isPartial = pct >= 40 && pct < 80;
                    return (
                      <div
                        key={tw.weekStart}
                        className={`rounded-lg border p-2.5 transition-all ${
                          isOnTrack
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : isPartial
                              ? "border-amber-500/30 bg-amber-500/5"
                              : "border-border bg-secondary/40"
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                          <span>Wk {formatDayDate(tw.weekStart).slice(0, 6)}</span>
                          <span
                            className={`font-semibold ${
                              isOnTrack ? "text-emerald-400" : isPartial ? "text-amber-400" : "text-muted-foreground"
                            }`}
                          >
                            {pct}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full transition-all ${
                              isOnTrack ? "bg-emerald-400" : isPartial ? "bg-amber-400" : "bg-primary"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {tw.done}/{tw.total} tasks {isOnTrack ? "✓" : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Active Goal Tasks (Today / Pending / Shifted) */}
      {activeTasks.length > 0 && (
        <div className="mt-4 rounded-xl bg-secondary/30 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              Goal Tasks ({pendingTasks.length} pending)
            </span>
            <span className="text-[10px] text-muted-foreground">
              Uncompleted tasks roll forward automatically
            </span>
          </div>

          <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {activeTasks.map((t) => {
              const isDone = !!t.completed_at;
              const isToday = t.task_date === today;
              // Past-day tasks are read-only: history cannot be toggled from here.
              const isPastDay = t.task_date < today;

              return (
                <li
                  key={t.id}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                    isDone ? "bg-secondary/20 opacity-70" : "bg-secondary/60 hover:bg-secondary/80"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      disabled={isCompleted || isPastDay}
                      onClick={() => onToggleTask(t.id, !isDone)}
                      aria-label={
                        isCompleted
                          ? `${t.title} is locked because its goal is completed`
                          : isPastDay
                            ? `${t.title} is locked because it belongs to a past day`
                            : isDone
                              ? `Mark ${t.title} incomplete`
                              : `Mark ${t.title} complete`
                      }
                      title={
                        isCompleted
                          ? "Goal completed — task locked"
                          : isPastDay
                            ? "Past day — tasks are read-only"
                            : undefined
                      }
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
                        isCompleted || isPastDay
                          ? "cursor-not-allowed border-border/60 bg-secondary/40 text-muted-foreground opacity-60"
                          : isDone
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:border-primary"
                      }`}
                    >
                      {isDone && (
                        <svg
                          viewBox="0 0 12 12"
                          className="h-3 w-3 stroke-primary-foreground"
                          fill="none"
                          strokeWidth={2.5}
                        >
                          <path d="M2.5 6.3l2.4 2.4 4.6-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    <span
                      className={`truncate ${
                        isDone ? "line-through text-muted-foreground" : "text-foreground font-medium"
                      }`}
                    >
                      {t.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <SubjectTag subject={t.subject_id ? subjectsMap.get(t.subject_id) : null} />
                    <span className="text-[10px] num text-muted-foreground">
                      {formatDayDate(t.task_date)}
                    </span>
                    {!isDone && t.task_date < today && (
                      <span className="rounded-full bg-destructive/15 border border-destructive/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                        Due
                      </span>
                    )}
                    {isToday && !isDone && (
                      <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                        Today
                      </span>
                    )}
                    {isDone && t.rollover_count > 0 && (
                      <span className="rounded-full bg-secondary/70 border border-border/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Completed late
                      </span>
                    )}

                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Upcoming (scheduled for future dates) — view-only */}
      {upcomingTasks.length > 0 && (
        <div className="mt-4 rounded-xl bg-secondary/30 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-primary" />
              Upcoming ({upcomingTasks.length})
            </span>
            <span className="text-[10px] text-muted-foreground">
              They appear on Today's Tasks when their day arrives
            </span>
          </div>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {upcomingTasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5 text-xs"
              >
                <span className="truncate font-medium text-foreground">{t.title}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <SubjectTag subject={t.subject_id ? subjectsMap.get(t.subject_id) : null} />
                  <span className="text-[10px] num text-muted-foreground">
                    {formatDayDate(t.task_date)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Linked Habits Section ── */}
      {(() => {
        const linkedHabits = allHabitStats.filter((s) => goalHabitIds.has(s.habit.id));
        // Habits can back multiple goals, so a habit is offerable here unless
        // it's already linked to THIS goal.
        const unlinkedHabits = allHabitStats.filter((s) => !goalHabitIds.has(s.habit.id));

        return (
          <div className="mt-4 rounded-xl bg-secondary/30 p-3.5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Repeat className="h-3.5 w-3.5 text-amber-400" />
                Linked Habits
                {linkedHabits.length > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-400 font-bold text-[10px]">
                    {linkedHabits.length}
                  </span>
                )}
              </div>
              {!isCompleted && unlinkedHabits.length > 0 && (
                <button
                  onClick={() => setShowLinkHabitDropdown((v) => !v)}
                  className="flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 -mx-1 -my-1 md:px-2 md:py-1 md:mx-0 md:my-0 text-[10px] font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors"
                >
                  <LinkIcon className="h-3 w-3" />
                  {showLinkHabitDropdown ? "Cancel" : "Link Habit"}
                </button>
              )}
            </div>

            {/* Dropdown to pick an existing habit to link */}
            {showLinkHabitDropdown && (
              <div className="mb-3 rounded-lg border border-amber-500/20 bg-card p-2 space-y-1 max-h-40 overflow-y-auto">
                {unlinkedHabits.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground px-1">All habits already linked.</p>
                ) : (
                  unlinkedHabits.map((s) => (
                    <button
                      key={s.habit.id}
                      onClick={() => {
                        onLinkHabit(s.habit.id);
                        setShowLinkHabitDropdown(false);
                      }}
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left hover:bg-secondary transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: `hsl(var(--primary))` }} />
                      <span className="font-medium truncate">{parseHabitTitle(s.habit.title).displayTitle}</span>
                      <span className="ml-auto text-muted-foreground text-[10px]">{s.habit.target_per_week}×/wk</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Linked habits list */}
            {linkedHabits.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No habits linked yet.{" "}
                {!isCompleted && unlinkedHabits.length > 0 && "Click 'Link Habit' to attach an existing habit to this goal."}
              </p>
            ) : (
              <div className="space-y-2">
                {linkedHabits.map((s) => {
                  const displayTitle = parseHabitTitle(s.habit.title).displayTitle;
                  const snap = snapFor(s.habit.id);
                  const lh = progress?.linkedHabits.find((x) => x.habitId === s.habit.id) ?? null;
                  const durationLimited = lh?.durationDays != null;
                  const habitOnTrack = durationLimited && lh
                    ? lh.daysLogged === lh.durationDays
                    : (lh?.weeksMet ?? 0) === (lh?.weeksTotal ?? -1);
                  const weekTarget = s.habit.target_per_week;
                  // "X/Y this wk" must start counting from the day this habit was
                  // linked to THIS goal (goal_habit_links.created_at), matching the
                  // hit-rate calc in computeHabitProgress. s.weekDone is the habit's
                  // raw all-time weekly count and would include pre-link logs, so
                  // rebuild it from the current week's doneDates, keeping only dates
                  // on/after the link date. created_at is NOT NULL (see the schema),
                  // and this map is built from the same goal_habit_links source the
                  // hit-rate uses, so linkStart is always populated — we intentionally
                  // never fall back to the raw s.weekDone, which is what caused the
                  // "1/7 bar but 0% / 2/7 bar but 14%" contradiction.
                  const linkStart = (habitDurations[s.habit.id]?.createdAt ?? "").slice(0, 10);
                  const weekDone = linkStart
                    ? s.doneDates.filter((d) => d >= linkStart).length
                    : 0;
                  const pctWeek = weekTarget > 0
                    ? Math.min(100, Math.round((weekDone / weekTarget) * 100))
                    : 0;
                  return (
                    <div key={s.habit.id} className="flex items-center gap-2 rounded-lg bg-amber-500/5 border border-amber-500/10 px-2.5 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-xs font-semibold text-foreground truncate">{displayTitle}</span>
                          {!snap && s.streak > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-orange-400">
                              <Flame className="h-3 w-3" />{s.streak}d
                            </span>
                          )}
                        </div>
                        {!snap && !durationLimited && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div
                                className="h-full rounded-full bg-amber-400 transition-all"
                                style={{ width: `${pctWeek}%` }}
                              />
                            </div>
                            <span className="text-[10px] num text-muted-foreground shrink-0">
                              {weekDone}/{weekTarget} this wk
                            </span>
                          </div>
                        )}
                        {lh && (
                          <p className="mt-1 flex items-center gap-1.5 text-[10px] num text-muted-foreground/70">
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${habitOnTrack ? "bg-primary" : "bg-amber-400"}`}
                            />
                            {durationLimited
                              ? `${lh.daysLogged}/${lh.durationDays} days (${lh.hitRate}%)`
                              : `${lh.hitRate}% hit rate · ${lh.weeksMet}/${lh.weeksTotal} wks on target`}
                            {snap && (
                              <span
                                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-400"
                                title={`Frozen when the goal completed (${new Date(snap.snapshottedAt).toLocaleDateString()})`}
                              >
                                <Snowflake className="h-2.5 w-2.5" />
                                Frozen
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      <HabitDurationControl
                        durationDays={habitDurations[s.habit.id]?.durationDays ?? null}
                        trackedFrom={habitDurations[s.habit.id]?.createdAt ?? ""}
                        canEdit={!isCompleted}
                        onSet={(days) => onSetDuration(s.habit.id, days)}
                      />
                      {!isCompleted && (
                        <button
                          onClick={() => onUnlinkHabit(s.habit.id)}
                          title="Unlink habit from goal"
                          className="shrink-0 p-1 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Unlink className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Linked Repeating Tasks */}
      {routines.length > 0 && (
        <div className="mt-4 rounded-xl bg-secondary/30 p-3.5">
          <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Repeat className="h-3.5 w-3.5 text-primary" />
            Repeating Schedule Linked to this Goal
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

      {/* Quick Add Task to Goal for Today */}
      {!isCompleted && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!inlineTask.trim()) return;
            onAddDirectTask(inlineTask.trim(), inlineSubjectId);
            setInlineTask("");
            setInlineSubjectId(null);
          }}
        >
          <Input
            value={inlineTask}
            onChange={(e) => setInlineTask(e.target.value)}
            placeholder={`Add a task for today to "${parsedGoal.cleanTitle}"...`}
            className="h-8.5 text-xs bg-background/70"
          />
          <SubjectSelect
            value={inlineSubjectId}
            onChange={setInlineSubjectId}
            subjects={subjects}
            className="h-8.5 w-32 shrink-0 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            className="h-8.5 px-3 text-xs shrink-0 gap-1"
            disabled={!inlineTask.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add</span>
          </Button>
        </form>
      )}

      {/* Action Buttons */}
      {!isCompleted && (
        <div className="mt-4 flex flex-wrap gap-2">
          {/* Mark Complete */}
          <button
            onClick={onMarkComplete}
            className="flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            Mark Complete
          </button>

          {/* Change deadline — available for all active goals */}
          <button
            onClick={() => {
              setShowExtendPanel((v) => !v);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              showExtendPanel
                ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                : "bg-secondary/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Change Deadline
            {showExtendPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {/* Schedule a future task for this goal */}
          {onScheduleTask && (
            <button
              onClick={() => {
                if (!showSchedulePanel && !scheduleDate) {
                  setScheduleDate(toISODate(addDays(new Date(), 1)));
                }
                setShowSchedulePanel((v) => !v);
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                showSchedulePanel
                  ? "bg-primary/20 text-primary"
                  : "bg-secondary/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule Task
              {showSchedulePanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
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

      {/* Change Deadline Panel */}
      {showExtendPanel && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-3 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            Change Goal Deadline
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            {goal.target_date
              ? `Current deadline: ${formatDayDate(goal.target_date)}. Pick a new date, quick-extend, or clear it entirely.`
              : "No deadline set. Pick a target date or quick-extend for this goal."}
          </p>

          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Quick Extend:</span>
            {[7, 14, 30].map((days) => {
              const baseDate =
                goal.target_date && goal.target_date > today
                  ? parseISODate(goal.target_date)
                  : new Date();
              const newDate = toISODate(addDays(baseDate, days));
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() => {
                    setExtendDate(newDate);
                    onExtendDate(newDate);
                    setShowExtendPanel(false);
                  }}
                  className="rounded-full bg-secondary/80 border border-border px-2.5 py-0.5 text-[11px] font-medium text-foreground hover:border-primary hover:bg-primary/10 transition-colors"
                >
                  +{days} Days
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={extendDate}
              onChange={(e) => setExtendDate(e.target.value)}
              className="h-9 text-sm flex-1 min-w-[140px]"
            />
            <Button
              size="sm"
              onClick={() => {
                onExtendDate(extendDate);
                setShowExtendPanel(false);
              }}
              disabled={!extendDate}
              className="h-9 px-3 text-xs gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Save
            </Button>
            {goal.target_date && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setExtendDate("");
                  onExtendDate("");
                  setShowExtendPanel(false);
                }}
                className="h-9 px-3 text-xs gap-1.5 text-muted-foreground hover:text-destructive border-dashed"
              >
                <X className="h-3.5 w-3.5" />
                Clear deadline
              </Button>
            )}
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

      {/* Schedule Future Task Panel */}
      {showSchedulePanel && onScheduleTask && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-primary mb-3 flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            Schedule a Future Task
          </h4>
          <div className="space-y-2">
            <Input
              value={scheduleTitle}
              onChange={(e) => setScheduleTitle(e.target.value)}
              placeholder={`Task title for "${parsedGoal.cleanTitle}"...`}
              className="h-9 text-sm bg-background/70"
            />
            <div className="flex flex-wrap items-center gap-2">
              <SubjectSelect
                value={scheduleSubjectId}
                onChange={setScheduleSubjectId}
                subjects={subjects}
                className="h-9 w-36 shrink-0 text-sm"
              />
              <Input
                type="date"
                value={scheduleDate}
                min={today}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="h-9 text-sm flex-1 min-w-[140px]"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (!scheduleTitle.trim() || !scheduleDate) return;
                onScheduleTask({
                  title: scheduleTitle.trim(),
                  date: scheduleDate,
                  subjectId: scheduleSubjectId,
                });
                setScheduleTitle("");
                setScheduleSubjectId(null);
                setShowSchedulePanel(false);
              }}
              disabled={!scheduleTitle.trim() || !scheduleDate}
              className="h-9 px-3 text-xs gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Schedule
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSchedulePanel(false)}
              className="h-9 px-3 text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation (destructive, gated behind explicit confirm) */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this goal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{parsedGoal.cleanTitle}", its linked tasks, and any routine links.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete();
                setShowDeleteConfirm(false);
              }}
              className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
            >
              Delete Goal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename-goal modal (pencil icon on the goal title) */}
      <Dialog open={showRenameModal} onOpenChange={setShowRenameModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename goal</DialogTitle>
            <DialogDescription>
              This changes the goal's title everywhere it appears. Its history and progress stay
              connected.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitRename();
              }
            }}
            placeholder="Goal title"
            aria-label="Goal title"
            autoFocus
            className="h-9 text-sm"
          />
          <div className="mt-2 space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Priority</label>
            <div className="grid grid-cols-4 gap-1">
              {[
                { val: null, label: "None" },
                { val: "Low" as const, label: "🟢 Low" },
                { val: "Med" as const, label: "🟡 Med" },
                { val: "High" as const, label: "🔴 High" },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setRenamePriority(opt.val)}
                  className={`rounded-md py-1 text-xs font-medium border transition-colors ${
                    renamePriority === opt.val
                      ? "border-primary bg-primary/20 text-foreground"
                      : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowRenameModal(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitRename}
              disabled={
                !renameDraft.trim() ||
                (renameDraft.trim() === parsedGoal.cleanTitle && renamePriority === parsedGoal.priority)
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

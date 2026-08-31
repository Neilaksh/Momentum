import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import {
  ensureProfile,
  loadHistory,
  loadWeek,
  recomputeStats,
  rolloverIncompleteGoalTasks,
} from "./tracker.server";
import { addDays, parseISODate, startOfWeek, toISODate, type GoalHabitSnapshot, type GoalHabitStat, type GoalProgress } from "./tracker-shared";
import { parseHabitTitle } from "./habits-shared";

export const getWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekStart: string }) =>
    z.object({ weekStart: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    return loadWeek(context.supabase, context.userId, data.weekStart);
  });

export const toggleDayTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; completed: boolean }) =>
    z.object({ id: z.string(), completed: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Completed-goal tasks are locked: the UI disables their checkboxes, this is
    // the server-side backstop so no client can toggle them afterwards.
    const { data: taskRow } = await context.supabase
      .from("day_tasks")
      .select("goal_id, task_date")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    // Past-day tasks are locked as well: history is read-only. The UI disables
    // the controls; this is the server-side backstop so no client can bypass it.
    if (taskRow?.task_date && taskRow.task_date < toISODate(new Date())) {
      throw new Error("Tasks from past days are locked and cannot be changed.");
    }
    if (taskRow?.goal_id) {
      const { data: goalRow } = await context.supabase
        .from("goals")
        .select("status")
        .eq("id", taskRow.goal_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (goalRow?.status === "completed") {
        throw new Error("This task belongs to a completed goal and is locked.");
      }
    }
    const patch: TablesUpdate<"day_tasks"> = {
      completed_at: data.completed ? new Date().toISOString() : null,
    };
    if (data.completed) {
      patch.progress_pct = 100;
    } else {
      // Un-marking a task manually re-engages it: clear stale / rollover state.
      patch.is_stale = false;
      patch.rollover_count = 0;
    }
    await context.supabase
      .from("day_tasks")
      .update(patch)
      .eq("id", data.id);
    const profile = await recomputeStats(context.supabase, context.userId);
    return { profile };
  });

export const addDayTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { date: string; title: string; goalId?: string | null; subjectId?: string | null }) =>
    z
      .object({
        date: z.string(),
        title: z.string().min(1).max(200),
        goalId: z.string().nullable().optional(),
        subjectId: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const title = data.title.trim();
    // Server-side idempotency guard: if the exact same manual task (same day,
    // same title) was already created within the last few seconds, treat the
    // repeat request as a duplicate submit and return the existing row instead
    // of inserting a second copy. Protects both the dashboard add-task input
    // and the goals-page direct-task add against double-fires.
    const dedupeWindowStart = new Date(Date.now() - 5_000).toISOString();
    const { data: existing } = await context.supabase
      .from("day_tasks")
      .select("id")
      .eq("user_id", context.userId)
      .eq("task_date", data.date)
      .eq("title", title)
      .eq("source", "oneoff")
      .gte("created_at", dedupeWindowStart)
      .limit(1)
      .maybeSingle();
    if (existing) return { task: existing };
    const { data: row } = await context.supabase
      .from("day_tasks")
      .insert({
        user_id: context.userId,
        task_date: data.date,
        title,
        source: "oneoff",
        goal_id: data.goalId ?? null,
        subject_id: data.subjectId ?? null,
        sort_order: 1000,
      })
      .select("*")
      .maybeSingle();
    return { task: row };
  });

export const deleteDayTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    // Past-day tasks are locked: history is read-only. The UI disables the delete
    // control; this is the server-side backstop so no client can bypass it.
    const { data: taskRow } = await context.supabase
      .from("day_tasks")
      .select("task_date")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (taskRow?.task_date && taskRow.task_date < toISODate(new Date())) {
      throw new Error("Tasks from past days are locked and cannot be deleted.");
    }
    await context.supabase.from("day_tasks").delete().eq("id", data.id);
    const profile = await recomputeStats(context.supabase, context.userId);
    return { profile };
  });

export const getRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("routine_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .order("weekday", { ascending: true })
      .order("sort_order", { ascending: true });
    return { tasks: data ?? [] };
  });

export const deleteRoutineTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase.from("routine_tasks").delete().eq("id", data.id);
    return { ok: true };
  });

export const updateRoutineTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      title?: string;
      weekday?: number;
      isActive?: boolean;
      goalId?: string | null;
      subjectId?: string | null;
      sortOrder?: number;
    }) =>
      z
        .object({
          id: z.string(),
          title: z.string().min(1).max(300).optional(),
          weekday: z.number().int().min(0).max(6).optional(),
          isActive: z.boolean().optional(),
          goalId: z.string().nullable().optional(),
          subjectId: z.string().nullable().optional(),
          sortOrder: z.number().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: TablesUpdate<"routine_tasks"> = {};
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.weekday !== undefined) patch.weekday = data.weekday;
    if (data.isActive !== undefined) patch.is_active = data.isActive;
    if (data.goalId !== undefined) patch.goal_id = data.goalId;
    if (data.subjectId !== undefined) patch.subject_id = data.subjectId;
    if (data.sortOrder !== undefined) patch.sort_order = data.sortOrder;

    const { data: updated } = await context.supabase
      .from("routine_tasks")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .maybeSingle();

    return { task: updated };
  });

export const toggleRoutineTaskActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; isActive: boolean }) =>
    z.object({ id: z.string(), isActive: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("routine_tasks")
      .update({ is_active: data.isActive })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const batchAddRoutineTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      items: Array<{
        weekday: number;
        title: string;
        goalId?: string | null;
        subjectId?: string | null;
        sortOrder?: number;
        isActive?: boolean;
      }>;
    }) =>
      z
        .object({
          items: z
            .array(
              z.object({
                weekday: z.number().int().min(0).max(6),
                title: z.string().min(1).max(300),
                goalId: z.string().nullable().optional(),
                subjectId: z.string().nullable().optional(),
                sortOrder: z.number().optional(),
                isActive: z.boolean().optional(),
              }),
            )
            .min(1),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const rows = data.items.map((item) => ({
      user_id: context.userId,
      weekday: item.weekday,
      title: item.title.trim(),
      goal_id: item.goalId ?? null,
      subject_id: item.subjectId ?? null,
      sort_order: item.sortOrder ?? 0,
      is_active: item.isActive ?? true,
    }));
    await context.supabase.from("routine_tasks").insert(rows);
    return { ok: true };
  });

export const clearAllRoutineTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("routine_tasks")
      .delete()
      .eq("user_id", context.userId);
    return { ok: true };
  });


/**
 * Weekly hit-rate for a habit over the whole Monday-weeks spanned since THAT
 * habit was linked to the goal (goal_habit_links.created_at) — not since the
 * goal itself was created — so a habit connected weeks after goal creation is
 * only accountable for weeks from the link onward. `weeksTotal` counts every
 * Monday-start week from the week that contains the link's `created_at`
 * through the current week (inclusive). A week "counts" when the habit's log
 * count for that week is >= its target_per_week.
 */
function computeHabitProgress(
  linkCreatedAt: string,
  habit: { id: string; title: string; target_per_week: number },
  done: Set<string> | undefined,
): GoalHabitStat {
  const created = parseISODate(linkCreatedAt.slice(0, 10));
  const weekStarts: string[] = [];
  let cur = startOfWeek(created);
  const end = startOfWeek(new Date());
  while (cur <= end) {
    weekStarts.push(toISODate(cur));
    cur = addDays(cur, 7);
  }
  const weeksTotal = weekStarts.length;
  const thisWeekStart = weekStarts[weekStarts.length - 1];
  let weeksMet = 0;
  // Partial credit for the current, still-in-progress week: fraction of the
  // weekly target actually logged so far (e.g. 1/7 logged ≈ 14%), capped at
  // 100% so over-logging can't exceed full credit.
  let partial = 0;
  for (const ws of weekStarts) {
    const weekEnd = toISODate(addDays(parseISODate(ws), 6));
    let count = 0;
    if (done) {
      for (const d of done) {
        if (d >= ws && d <= weekEnd) count += 1;
        if (count >= habit.target_per_week) break;
      }
    }
    if (count >= habit.target_per_week) {
      weeksMet += 1;
    } else if (ws === thisWeekStart && count > 0) {
      // Current (in-progress) week: partial credit instead of binary 1/0.
      partial = Math.min(count / habit.target_per_week, 1);
    }
  }
  const hitRate = weeksTotal > 0 ? Math.round((weeksMet + partial) / weeksTotal * 100) : 0;
  return {
    habitId: habit.id,
    title: parseHabitTitle(habit.title).displayTitle || habit.title,
    targetPerWeek: habit.target_per_week,
    weeksTotal,
    weeksMet,
    hitRate,
  };
}

/**
 * Overall goal progress = simple average of the task score (completed vs total
 * linked day_tasks) and the habit score (average weekly hit-rate of linked
 * habits, each measured since its own link was created). Falls back to
 * whichever single score exists; both scores are null when the goal has no
 * tasks and no habits.
 */
function computeGoalProgress(
  stat: { total: number; done: number },
  habits: { id: string; title: string; target_per_week: number }[],
  logsByHabit: Map<string, Set<string>>,
  linkedHabitLinks: Map<string, string>,
): GoalProgress {
  const taskTotal = stat.total;
  const taskDone = stat.done;
  const hasTasks = taskTotal > 0;
  const taskScore = hasTasks ? Math.round((taskDone / taskTotal) * 100) : null;

  // Linked habits are pre-resolved by the caller from goal_habit_links, keyed
  // by habit id with that link's own created_at. A habit shared across goals
  // gets an independent window per goal, starting when THAT link was made —
  // not when the goal was created — so a habit linked late isn't penalized
  // for the weeks before it was connected.
  const linked = habits.filter((h) => linkedHabitLinks.has(h.id));

  const linkedStats: GoalHabitStat[] = linked.map((h) =>
    computeHabitProgress(linkedHabitLinks.get(h.id)!, h, logsByHabit.get(h.id)),
  );

  const hasHabits = linkedStats.length > 0;
  const habitScore = hasHabits
    ? Math.round(linkedStats.reduce((sum: number, s) => sum + s.hitRate, 0) / linkedStats.length)
    : null;
  // Strict on-track: every week in the link window — past and current — must be
  // fully met. Using weeksMet === weeksTotal (not hitRate >= 100) avoids a
  // Math.round edge where a long, mostly-perfect window could tip a not-yet-finished
  // current week (e.g. 28/29 weeks, current 6/7) into a rounded 100%.
  const habitsOnTrack = linkedStats.filter((s) => s.weeksMet === s.weeksTotal).length;

  const overall =
    hasTasks && hasHabits
      ? Math.round(((taskScore ?? 0) + (habitScore ?? 0)) / 2)
      : hasTasks
        ? taskScore
        : hasHabits
          ? habitScore
          : null;

  return {
    taskScore,
    taskTotal,
    taskDone,
    habitScore,
    habitsOnTrack,
    habitsTotal: linkedStats.length,
    overall,
    hasTasks,
    hasHabits,
    linkedHabits: linkedStats,
  };
}

/**
 * Freeze each linked habit's weekly hit-rate into goal_habit_snapshots at the
 * moment a goal completes. Called on BOTH completion paths — the auto-complete
 * transition in getGoals and a manual "Mark Complete" (updateGoalStatus) — so a
 * completed goal always has frozen stats regardless of how it finished. Rows
 * are upserted on (goal_id, habit_id), so a later re-completion overwrites the
 * old snapshot. Reopening does not delete the row; it is simply ignored while
 * the goal is active, and the habit keeps logging live everywhere else.
 */
async function snapshotGoalHabitStats(
  supabase: SupabaseClient<Database>,
  userId: string,
  goalIds: string[],
): Promise<void> {
  if (goalIds.length === 0) return;
  const { data: goalRows } = await supabase
    .from("goals")
    .select("id")
    .in("id", goalIds)
    .eq("user_id", userId);
  const goals = goalRows ?? [];
  if (goals.length === 0) return;

  // Many-to-many goal<->habit links for exactly these goals, so a habit shared
  // across several goals is snapshotted independently per goal (each snapshot
  // row is keyed on (goal_id, habit_id)). Each link carries its own created_at,
  // which — not the goal's — is the hit-rate window start for that pair.
  const habitLinksByGoal = new Map<string, Map<string, string>>();
  const { data: linkRows } = await supabase
    .from("goal_habit_links")
    .select("goal_id, habit_id, created_at")
    .in("goal_id", goals.map((g) => g.id));
  for (const l of linkRows ?? []) {
    const byHabit = habitLinksByGoal.get(l.goal_id) ?? new Map<string, string>();
    byHabit.set(l.habit_id, l.created_at);
    habitLinksByGoal.set(l.goal_id, byHabit);
  }

  const { data: habitRows } = await supabase
    .from("habits")
    .select("id, title, target_per_week")
    .eq("user_id", userId)
    .eq("is_archived", false);
  const habits = habitRows ?? [];

  const logsByHabit = new Map<string, Set<string>>();
  if (habits.length > 0) {
    const { data: logRows } = await supabase
      .from("habit_logs")
      .select("habit_id, log_date")
      .in("habit_id", habits.map((h) => h.id));
    for (const l of logRows ?? []) {
      const set = logsByHabit.get(l.habit_id) ?? new Set<string>();
      set.add(l.log_date);
      logsByHabit.set(l.habit_id, set);
    }
  }

  const rows: TablesInsert<"goal_habit_snapshots">[] = [];
  for (const g of goals) {
    // Same computation the UI displays, so the snapshot matches what the user
    // saw at the moment of completion.
    const progress = computeGoalProgress({ total: 0, done: 0 }, habits, logsByHabit, habitLinksByGoal.get(g.id) ?? new Map<string, string>());
    for (const lh of progress.linkedHabits) {
      rows.push({
        goal_id: g.id,
        habit_id: lh.habitId,
        weeks_on_target: lh.weeksMet,
        total_weeks: lh.weeksTotal,
        hit_rate_pct: lh.hitRate,
      });
    }
  }
  if (rows.length > 0) {
    await supabase.from("goal_habit_snapshots").upsert(rows, { onConflict: "goal_id,habit_id" });
  }
}

export const getGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;

    // Automatically rollover uncompleted goal tasks to today
    await rolloverIncompleteGoalTasks(supabase, context.userId);

    const { data: goals } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });

    const goalRows = goals ?? [];

    // Per-goal day_task completion stats (full rows — GoalCard renders them and
    // GoalsResponse on the client types them as complete day_tasks rows).
    const { data: linked } = await supabase
      .from("day_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .not("goal_id", "is", null)
      .order("task_date", { ascending: false });

    const linkedRows = linked ?? [];

    // Rollover-superseded rows must not count toward a goal's task total/done.
    // When an uncompleted goal task rolls over, a fresh copy is created on a
    // later day while the previous instance stays frozen on its own day as a
    // read-only historical record — and only the newest copy can ever be
    // completed (older rows are locked). Counting the whole chain inflates the
    // denominator, so a goal whose task rolled over even once could never
    // reach 100%.
    //
    // A row R is superseded (and excluded from the counts) when another row C
    // of the same chain — same user_id, goal_id and normalized title — exists
    // on a LATER task_date such that:
    //   1. C.rollover_count === R.rollover_count + 1, i.e. a later copy
    //      advanced the chain by exactly one more rollover, or
    //   2. C.rollover_count === R.rollover_count with R.rollover_count >= 1.
    //      The rollover pass stamps the source row AND the fresh copy with the
    //      same count, so a frozen source and its newer copy can share one
    //      count; the later row is the copy and the earlier one is superseded.
    //      The >= 1 guard keeps two independently-created tasks that happen to
    //      share a title and never rolled (both stay at 0) as separate, with
    //      both counting.
    //   3. R is the oldest (earliest task_date) row of a multi-row chain whose
    //      rollover_count >= 1 — the chain's original. Once any later copy
    //      exists the original is frozen history, and after the chain hits the
    //      stale limit it can even carry the highest count.
    // Only the newest copy of each rollover chain contributes to total/done.
    // Routines no longer auto-materialize into day_tasks, so these chains are
    // direct/one-off goal tasks only — no recurring-instance special-casing.
    const supersededIds = new Set<string>();
    if (linkedRows.length > 0) {
      const chains = new Map<string, typeof linkedRows>();
      for (const row of linkedRows) {
        const key = `${row.goal_id}|${(row.title ?? "").trim().toLowerCase()}`;
        const list = chains.get(key) ?? [];
        list.push(row);
        chains.set(key, list);
      }
      for (const list of chains.values()) {
        if (list.length > 1) {
          let oldest = list[0]!;
          for (const row of list) {
            if ((row.task_date ?? "") < (oldest.task_date ?? "")) oldest = row;
          }
          if ((oldest.rollover_count ?? 0) >= 1) supersededIds.add(oldest.id);
        }
        for (const r of list) {
          const rCount = r.rollover_count ?? 0;
          for (const c of list) {
            if (c.id === r.id || !(c.task_date > r.task_date)) continue;
            const cCount = c.rollover_count ?? 0;
            if (cCount === rCount + 1 || (cCount === rCount && rCount >= 1)) {
              supersededIds.add(r.id);
              break;
            }
          }
        }
      }
    }

    const stats: Record<string, { total: number; done: number }> = {};
    const tasksByGoal: Record<string, typeof linkedRows> = {};

    for (const row of linkedRows) {
      if (!row.goal_id) continue; // query filters goal_id IS NOT NULL; guard for the type
      if (!tasksByGoal[row.goal_id]) tasksByGoal[row.goal_id] = [];
      // The Goal Tasks list keeps every row — frozen originals stay visible as
      // read-only history (they are locked client-side and server-side). Only
      // the percentage/count math below excludes superseded rollover copies.
      tasksByGoal[row.goal_id]!.push(row);

      if (supersededIds.has(row.id)) continue;

      const e = stats[row.goal_id] ?? { total: 0, done: 0 };
      e.total += 1;
      if (row.completed_at) e.done += 1;
      stats[row.goal_id] = e;
    }

    // Fetch linked routine tasks for each goal
    const { data: routines } = await supabase
      .from("routine_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .not("goal_id", "is", null)
      .eq("is_active", true);

    const routinesByGoal: Record<string, NonNullable<typeof routines>> = {};
    for (const rt of routines ?? []) {
      if (!rt.goal_id) continue; // query filters goal_id IS NOT NULL; guard for the type
      if (!routinesByGoal[rt.goal_id]) routinesByGoal[rt.goal_id] = [];
      routinesByGoal[rt.goal_id]!.push(rt);
    }

    // Habits and their logs — used to compute the habit half of each goal's
    // progress. Habit->goal membership comes from goal_habit_links (below).
    const { data: habitRows } = await supabase
      .from("habits")
      .select("id, title, target_per_week")
      .eq("user_id", context.userId)
      .eq("is_archived", false);

    const habits = habitRows ?? [];

    // Many-to-many goal<->habit links: a habit may back several goals, and each
    // (goal, habit) pair computes its own hit-rate starting from that link's
    // created_at — not the goal's. The flattened habit-id record is also
    // returned to the client so the goal detail view's Linked Habits list
    // reads the join table instead of the old single-FK column.
    const habitLinksByGoal = new Map<string, Map<string, string>>();
    if (goalRows.length > 0) {
      const { data: linkRows } = await supabase
        .from("goal_habit_links")
        .select("goal_id, habit_id, created_at")
        .in("goal_id", goalRows.map((gr) => gr.id));
      for (const l of linkRows ?? []) {
        const byHabit = habitLinksByGoal.get(l.goal_id) ?? new Map<string, string>();
        byHabit.set(l.habit_id, l.created_at);
        habitLinksByGoal.set(l.goal_id, byHabit);
      }
    }
    const habitIdsByGoalRecord: Record<string, string[]> = {};
    for (const [gid, links] of habitLinksByGoal) habitIdsByGoalRecord[gid] = [...links.keys()];
    const logsByHabit = new Map<string, Set<string>>();
    if (habits.length > 0) {
      const { data: logRows } = await supabase
        .from("habit_logs")
        .select("habit_id, log_date")
        .in("habit_id", habits.map((h) => h.id));
      for (const l of logRows ?? []) {
        const set = logsByHabit.get(l.habit_id) ?? new Set<string>();
        set.add(l.log_date);
        logsByHabit.set(l.habit_id, set);
      }
    }

    const progressByGoal: Record<string, GoalProgress> = {};
    for (const g of goalRows) {
      progressByGoal[g.id] = computeGoalProgress(
        stats[g.id] ?? { total: 0, done: 0 },
        habits,
        logsByHabit,
        habitLinksByGoal.get(g.id) ?? new Map<string, string>(),
      );
    }

    // Auto-complete: a goal auto-completes ONLY on the genuine transition from
    // below 100% to 100% — never on every read. The last computed overall is
    // snapshotted on the goal row (goals.last_overall_pct), so a goal the user
    // manually reopened while its linked tasks/habits are still at 100% stays
    // open until progress actually changes (drops below 100, then climbs back).
    const toComplete = goalRows.filter((g) => {
      const p = progressByGoal[g.id];
      if (!p || p.overall === null) return false;
      if (g.status === "completed") return false;
      return p.overall >= 100 && (g.last_overall_pct ?? 0) < 100;
    });
    if (toComplete.length > 0) {
      const completeIds = toComplete.map((g) => g.id);
      await supabase.from("goals").update({ status: "completed" }).in("id", completeIds);
      // Match the manual-complete path (updateGoalStatus): deactivate linked
      // repeating routines so materializeWeek stops creating tasks for the goal.
      await supabase
        .from("routine_tasks")
        .update({ is_active: false })
        .in("goal_id", completeIds)
        .eq("user_id", context.userId);
      // Freeze each linked habit's weekly hit-rate at the completion moment —
      // this block runs only on the genuine <100 -> 100 transition.
      await snapshotGoalHabitStats(supabase, context.userId, completeIds);
      for (const g of toComplete) g.status = "completed";
    }

    // Persist each goal's last computed overall snapshot so the next read can
    // detect a <100 -> 100 transition. Only rows whose snapshot actually changed
    // are written, so steady-state reads perform zero extra queries.
    for (const g of goalRows) {
      const overall = progressByGoal[g.id]?.overall ?? null;
      if ((g.last_overall_pct ?? null) === overall) continue;
      await supabase.from("goals").update({ last_overall_pct: overall }).eq("id", g.id);
    }

    // Frozen habit hit-rates taken at each goal's completion moment. Shown
    // inside a completed goal instead of the live stats, which keep moving
    // because the habits themselves continue running everywhere else.
    const snapshotsByGoal: Record<string, GoalHabitSnapshot[]> = {};
    if (goalRows.length > 0) {
      const { data: snapRows } = await supabase
        .from("goal_habit_snapshots")
        .select("goal_id, habit_id, weeks_on_target, total_weeks, hit_rate_pct, snapshotted_at")
        .in("goal_id", goalRows.map((g) => g.id));
      for (const s of snapRows ?? []) {
        if (!snapshotsByGoal[s.goal_id]) snapshotsByGoal[s.goal_id] = [];
        snapshotsByGoal[s.goal_id]!.push({
          habitId: s.habit_id,
          weeksOnTarget: s.weeks_on_target,
          totalWeeks: s.total_weeks,
          hitRatePct: s.hit_rate_pct,
          snapshottedAt: s.snapshotted_at,
        });
      }
    }

    // Freeze completed goals' habit stats at their completion-time snapshots.
    // Linked habits keep logging live everywhere else in the app, but inside a
    // completed goal the per-habit hit-rates (and the habit score / on-track
    // count / overall derived from them) must show the values frozen at
    // completion, not numbers that decay as empty weeks accumulate. Habits
    // linked after completion (no snapshot) keep their live values, per-habit.
    // Reopening the goal drops it out of this branch, so live stats resume;
    // a later re-completion upserts a fresh snapshot over the old one.
    for (const g of goalRows) {
      if (g.status !== "completed") continue;
      const snaps = snapshotsByGoal[g.id];
      if (!snaps || snaps.length === 0) continue;
      const p = progressByGoal[g.id];
      if (!p) continue;
      const snapMap = new Map(snaps.map((s) => [s.habitId, s]));
      const linkedHabits = p.linkedHabits.map((lh) => {
        const s = snapMap.get(lh.habitId);
        return s ? { ...lh, weeksMet: s.weeksOnTarget, weeksTotal: s.totalWeeks, hitRate: s.hitRatePct } : lh;
      });
      const habitScore =
        linkedHabits.length > 0
          ? Math.round(linkedHabits.reduce((sum, s) => sum + s.hitRate, 0) / linkedHabits.length)
          : null;
      // Strict on-track for frozen stats too (same rule as live path):
      // snapshotted weeksOnTarget must equal totalWeeks. hitRate >= 100 is avoided
      // because a rounded-up frozen percentage could mark a partially-met final
      // week (captured at completion) as on-track when it isn't.
      const habitsOnTrack = linkedHabits.filter((s) => s.weeksMet === s.weeksTotal).length;
      const overall =
        p.taskScore !== null && habitScore !== null
          ? Math.round((p.taskScore + habitScore) / 2)
          : (p.taskScore ?? habitScore);
      progressByGoal[g.id] = { ...p, linkedHabits, habitScore, habitsOnTrack, overall };
    }

    // NOTE: overdue detection is intentionally done in the UI from target_date.
    return {
      goals: goalRows,
      stats,
      routinesByGoal,
      tasksByGoal,
      progressByGoal,
      snapshotsByGoal,
      habitIdsByGoal: habitIdsByGoalRecord,
    };
  });

export const saveGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string | null;
      title: string;
      description?: string | null;
      targetDate?: string | null;
      status?: string;
    }) =>
      z
        .object({
          id: z.string().nullable().optional(),
          title: z.string().min(1).max(200),
          description: z.string().nullable().optional(),
          targetDate: z.string().nullable().optional(),
          status: z.string().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const payload = {
      title: data.title.trim(),
      description: data.description ?? null,
      target_date: data.targetDate || null,
      status: data.status ?? "active",
    };
    if (data.id) {
      await supabase.from("goals").update(payload).eq("id", data.id);
      return { ok: true };
    }
    const { data: newGoal } = await supabase
      .from("goals")
      .insert({ ...payload, user_id: context.userId })
      .select("id")
      .maybeSingle();
    return { ok: true, goalId: newGoal?.id ?? null };
  });

export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    // Deactivate all linked routine tasks so they stop repeating
    await supabase
      .from("routine_tasks")
      .update({ is_active: false })
      .eq("goal_id", data.id)
      .eq("user_id", context.userId);
    await supabase.from("goals").delete().eq("id", data.id);
    return { ok: true };
  });

/** Remove a batch of routine tasks linked to a goal (atomic, avoids partial-failure from N parallel calls). */
export const removeGoalRoutineTasksBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[] }) =>
    z.object({ ids: z.array(z.string()).min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    await supabase
      .from("routine_tasks")
      .delete()
      .in("id", data.ids)
      .eq("user_id", context.userId);
    await supabase
      .from("day_tasks")
      .delete()
      .in("routine_task_id", data.ids)
      .eq("user_id", context.userId)
      .is("completed_at", null);
    return { ok: true };
  });

/** Update goal status: complete | active | overdue. Optionally extend target date. */
export const updateGoalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; status: string; newTargetDate?: string | null }) =>
      z
        .object({
          id: z.string(),
          status: z.enum(["active", "completed", "overdue"]),
          newTargetDate: z.string().nullable().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const patch: TablesUpdate<"goals"> = { status: data.status };
    if (data.newTargetDate !== undefined) patch.target_date = data.newTargetDate;

    // When marking complete, deactivate linked routine tasks so they stop appearing
    if (data.status === "completed") {
      await supabase
        .from("routine_tasks")
        .update({ is_active: false })
        .eq("goal_id", data.id)
        .eq("user_id", context.userId);
      // Freeze linked habit hit-rates at the completion moment (manual path).
      await snapshotGoalHabitStats(supabase, context.userId, [data.id]);
    }
    // When re-activating, re-enable linked routine tasks
    if (data.status === "active") {
      await supabase
        .from("routine_tasks")
        .update({ is_active: true })
        .eq("goal_id", data.id)
        .eq("user_id", context.userId);
    }

    await supabase.from("goals").update(patch).eq("id", data.id).eq("user_id", context.userId);
    return { ok: true };
  });


export const getHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const profile = await ensureProfile(supabase, context.userId);
    const history = await loadHistory(supabase, context.userId, 12);
    return { profile, ...history };
  });

export const resetTrackerData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const userId = context.userId;

    // Delete all user day tasks
    await supabase.from("day_tasks").delete().eq("user_id", userId);
    // Delete all user habit logs
    await supabase.from("habit_logs").delete().eq("user_id", userId);
    // Delete all user habits
    await supabase.from("habits").delete().eq("user_id", userId);
    // Delete all user goals
    await supabase.from("goals").delete().eq("user_id", userId);
    // Delete all user routine tasks
    await supabase.from("routine_tasks").delete().eq("user_id", userId);

    // Reset profile stats
    await supabase
      .from("profiles")
      .update({
        total_xp: 0,
        level: 1,
        current_streak: 0,
        best_streak: 0,
        last_active_day: null,
      })
      .eq("id", userId);

    return { ok: true };
  });

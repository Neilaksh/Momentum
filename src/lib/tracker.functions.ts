import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ensureProfile,
  loadHistory,
  loadDay,
  loadWeek,
  materializeWeek,
  recomputeStats,
  rolloverIncompleteGoalTasks,
} from "./tracker.server";
import { addDays, goalLinkKey, parseISODate, startOfWeek, toISODate } from "./tracker-shared";

export const getWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekStart: string }) =>
    z.object({ weekStart: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    return loadWeek(context.supabase as any, context.userId, data.weekStart);
  });

export const toggleDayTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; completed: boolean }) =>
    z.object({ id: z.string(), completed: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { completed_at: data.completed ? new Date().toISOString() : null };
    if (data.completed) {
      patch["progress_pct"] = 100;
    } else {
      // Un-marking a task manually re-engages it: clear stale / rollover state.
      patch["is_stale"] = false;
      patch["rollover_count"] = 0;
    }
    await (context.supabase as any)
      .from("day_tasks")
      .update(patch)
      .eq("id", data.id);
    const profile = await recomputeStats(context.supabase as any, context.userId);
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
    const { data: existing } = await (context.supabase as any)
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
    const { data: row } = await (context.supabase as any)
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
    await (context.supabase as any).from("day_tasks").delete().eq("id", data.id);
    const profile = await recomputeStats(context.supabase as any, context.userId);
    return { profile };
  });

export const updateDayTaskDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; date: string }) =>
      z.object({ id: z.string(), date: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await (context.supabase as any)
      .from("day_tasks")
      .update({ task_date: data.date, is_stale: false, rollover_count: 0 })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const getRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await (context.supabase as any)
      .from("routine_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .order("weekday", { ascending: true })
      .order("sort_order", { ascending: true });
    return { tasks: data ?? [] };
  });

export const addRoutineTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekday: number; title: string; goalId?: string | null; subjectId?: string | null }) =>
    z
      .object({
        weekday: z.number().int().min(0).max(6),
        title: z.string().min(1).max(200),
        goalId: z.string().nullable().optional(),
        subjectId: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await (context.supabase as any)
      .from("routine_tasks")
      .insert({
        user_id: context.userId,
        weekday: data.weekday,
        title: data.title.trim(),
        goal_id: data.goalId ?? null,
        subject_id: data.subjectId ?? null,
      })
      .select("*")
      .maybeSingle();
    return { task: row };
  });

export const deleteRoutineTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await (context.supabase as any).from("routine_tasks").delete().eq("id", data.id);
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
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch["title"] = data.title.trim();
    if (data.weekday !== undefined) patch["weekday"] = data.weekday;
    if (data.isActive !== undefined) patch["is_active"] = data.isActive;
    if (data.goalId !== undefined) patch["goal_id"] = data.goalId;
    if (data.subjectId !== undefined) patch["subject_id"] = data.subjectId;
    if (data.sortOrder !== undefined) patch["sort_order"] = data.sortOrder;

    const { data: updated } = await (context.supabase as any)
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
    await (context.supabase as any)
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
    await (context.supabase as any).from("routine_tasks").insert(rows);
    return { ok: true };
  });

export const batchDeleteRoutineTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[] }) =>
    z.object({ ids: z.array(z.string()).min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await (context.supabase as any)
      .from("routine_tasks")
      .delete()
      .in("id", data.ids)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const clearAllRoutineTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await (context.supabase as any)
      .from("routine_tasks")
      .delete()
      .eq("user_id", context.userId);
    return { ok: true };
  });


export const getGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as any;

    // Automatically rollover uncompleted goal tasks to today
    await rolloverIncompleteGoalTasks(supabase, context.userId);

    const { data: goals } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });

    // Per-goal day_task completion stats
    const { data: linked } = await supabase
      .from("day_tasks")
      .select("id, goal_id, completed_at, task_date, title, source, routine_task_id, sort_order, subject_id")
      .eq("user_id", context.userId)
      .not("goal_id", "is", null)
      .order("task_date", { ascending: false });

    const stats: Record<string, { total: number; done: number }> = {};
    const tasksByGoal: Record<string, any[]> = {};

    for (const row of (linked ?? []) as any[]) {
      const e = stats[row.goal_id] ?? { total: 0, done: 0 };
      e.total += 1;
      if (row.completed_at) e.done += 1;
      stats[row.goal_id] = e;

      if (!tasksByGoal[row.goal_id]) tasksByGoal[row.goal_id] = [];
      tasksByGoal[row.goal_id]!.push(row);
    }

    // Fetch linked routine tasks for each goal
    const { data: routines } = await supabase
      .from("routine_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .not("goal_id", "is", null)
      .eq("is_active", true);

    const routinesByGoal: Record<string, any[]> = {};
    for (const rt of (routines ?? []) as any[]) {
      if (!routinesByGoal[rt.goal_id]) routinesByGoal[rt.goal_id] = [];
      routinesByGoal[rt.goal_id]!.push(rt);
    }

    // NOTE: overdue detection is intentionally done in the UI from target_date.
    // We do NOT auto-mutate goal status on read — only explicit user actions should write.
    return { goals: goals ?? [], stats, routinesByGoal, tasksByGoal };
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
    const supabase = context.supabase as any;
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
    const supabase = context.supabase as any;
    // Deactivate all linked routine tasks so they stop repeating
    await supabase
      .from("routine_tasks")
      .update({ is_active: false })
      .eq("goal_id", data.id)
      .eq("user_id", context.userId);
    await supabase.from("goals").delete().eq("id", data.id);
    return { ok: true };
  });

/** Attach a repeating routine task to a goal (all 7 weekdays by default, customizable). */
export const addGoalRoutineTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { goalId: string; title: string; weekdays: number[] }) =>
      z
        .object({
          goalId: z.string(),
          title: z.string().min(1).max(200),
          weekdays: z.array(z.number().int().min(0).max(6)).min(1),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const rows = data.weekdays.map((wd) => ({
      user_id: context.userId,
      weekday: wd,
      title: data.title.trim(),
      goal_id: data.goalId,
      is_active: true,
    }));
    await supabase.from("routine_tasks").insert(rows);

    // Auto-materialize into current week's day_tasks immediately
    const weekStart = toISODate(startOfWeek(new Date()));
    await materializeWeek(supabase, context.userId, weekStart);

    return { ok: true };
  });

/** Remove a specific routine task linked to a goal. */
export const removeGoalRoutineTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    await supabase
      .from("routine_tasks")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    await supabase
      .from("day_tasks")
      .delete()
      .eq("routine_task_id", data.id)
      .eq("user_id", context.userId)
      .is("completed_at", null);
    return { ok: true };
  });

/** Remove a batch of routine tasks linked to a goal (atomic, avoids partial-failure from N parallel calls). */
export const removeGoalRoutineTasksBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[] }) =>
    z.object({ ids: z.array(z.string()).min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
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
    const supabase = context.supabase as any;
    const patch: Record<string, unknown> = { status: data.status };
    if (data.newTargetDate !== undefined) patch["target_date"] = data.newTargetDate;

    // When marking complete, deactivate linked routine tasks so they stop appearing
    if (data.status === "completed") {
      await supabase
        .from("routine_tasks")
        .update({ is_active: false })
        .eq("goal_id", data.id)
        .eq("user_id", context.userId);
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
    const supabase = context.supabase as any;
    const profile = await ensureProfile(supabase, context.userId);
    const history = await loadHistory(supabase, context.userId, 12);
    return { profile, ...history };
  });

export const getDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { date: string }) => z.object({ date: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    return loadDay(context.supabase as any, context.userId, data.date);
  });

export const resetTrackerData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as any;
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

/** Schedule a goal task on a start date, optionally repeating it for N consecutive days. */
export const scheduleGoalTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      goalId: string;
      title: string;
      startDate: string;
      repeatDays: number;
      weekdays?: number[];
      subjectId?: string | null;
    }) =>
      z
        .object({
          goalId: z.string(),
          title: z.string().min(1).max(200),
          startDate: z.string(),
          repeatDays: z.number().int().min(1).max(365),
          weekdays: z.array(z.number().int().min(0).max(6)).optional(),
          subjectId: z.string().nullable().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const start = parseISODate(data.startDate);
    const allowed = data.weekdays && data.weekdays.length > 0 ? new Set(data.weekdays) : null;
    const rows = Array.from({ length: data.repeatDays }, (_, i) => addDays(start, i))
      .filter((d) => !allowed || allowed.has((d.getDay() + 6) % 7)) // 0 = Monday
      .map((d) => ({
        user_id: context.userId,
        task_date: toISODate(d),
        title: data.title.trim(),
        source: "oneoff",
        goal_id: data.goalId,
        subject_id: data.subjectId ?? null,
        sort_order: 1000,
      }));
    if (rows.length === 0) return { ok: true, created: 0 };
    // Skip any (date, goal, title) that already has a goal-linked row — the
    // rollover or materializeWeek may have created it first, and re-scheduling
    // would otherwise duplicate the task on those days.
    const dates = rows.map((r: any) => r.task_date);
    const { data: existing } = await (context.supabase as any)
      .from("day_tasks")
      .select("task_date, goal_id, title")
      .eq("user_id", context.userId)
      .in("task_date", dates);
    const haveGoal = new Set(
      (existing ?? [])
        .filter((r: any) => r.goal_id)
        .map((r: any) => goalLinkKey(r.task_date, r)),
    );
    const toInsert = rows.filter(
      (r: any) => !haveGoal.has(goalLinkKey(r.task_date, { goal_id: r.goal_id, title: r.title as string })),
    );
    if (toInsert.length === 0) return { ok: true, created: 0 };
    await (context.supabase as any).from("day_tasks").insert(toInsert);
    return { ok: true, created: toInsert.length };
  });

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
import {
  addDays,
  formatTaskDescription as formatTaskDescriptionServer,
  getSupersededRolloverIds,
  parseISODate,
  parseRoutineTitle,
  parseTaskDescription as parseTaskDescriptionServer,
  startOfWeek,
  toISODate,
  type GoalHabitSnapshot,
  type GoalHabitStat,
  type GoalProgress,
} from "./tracker-shared";
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
    await context.supabase.from("day_tasks").update(patch).eq("id", data.id);
    const profile = await recomputeStats(context.supabase, context.userId);
    return { profile };
  });

export const renameDayTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; title: string }) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(300) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    // Normalize exactly like taskKey does (tracker.server.ts) so accidental
    // whitespace/case drift can never create a phantom second identity.
    const newTitle = data.title.trim();
    if (!newTitle) throw new Error("Task title cannot be empty.");

    const { data: taskRow } = await supabase
      .from("day_tasks")
      .select("id, title, goal_id, routine_task_id, task_date")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!taskRow) throw new Error("Task not found.");

    // Past-day tasks are locked: history is read-only. The UI hides the edit
    // control; this is the server-side backstop so no client can bypass it.
    // (Mirrors toggleDayTask / deleteDayTask.)
    if (taskRow.task_date && taskRow.task_date < toISODate(new Date())) {
      throw new Error("Tasks from past days are locked and cannot be changed.");
    }

    // Completed-goal tasks are locked as well — their frozen rollover history
    // must never be retitled. (Mirrors toggleDayTask.)
    if (taskRow.goal_id) {
      const { data: goalRow } = await supabase
        .from("goals")
        .select("status")
        .eq("id", taskRow.goal_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (goalRow?.status === "completed") {
        throw new Error("This task belongs to a completed goal and is locked.");
      }
    }

    // Chain-wide rename: task identity for rollover/dedup is
    // title.trim().toLowerCase() | goal_id | routine_task_id. Renaming only the
    // visible row would fork that identity — the uncompleted ancestors under the
    // old title would roll forward as a "new" duplicate task, split the goal
    // progress chain (goal_id|title grouping) and double the stale budget. So
    // every row sharing the current key is renamed together, preserving the
    // chain under the new title.
    const oldKeyTitle = (taskRow.title ?? "").trim().toLowerCase();
    let chainQuery = supabase.from("day_tasks").select("id, title").eq("user_id", context.userId);
    chainQuery = taskRow.goal_id
      ? chainQuery.eq("goal_id", taskRow.goal_id)
      : chainQuery.is("goal_id", null);
    chainQuery = taskRow.routine_task_id
      ? chainQuery.eq("routine_task_id", taskRow.routine_task_id)
      : chainQuery.is("routine_task_id", null);
    const { data: keyRows, error: keyErr } = await chainQuery;
    if (keyErr) throw new Error(keyErr.message);
    const chainIds = (keyRows ?? [])
      .filter((r) => (r.title ?? "").trim().toLowerCase() === oldKeyTitle)
      .map((r) => r.id);

    if (chainIds.length > 0) {
      const { error } = await supabase
        .from("day_tasks")
        .update({ title: newTitle })
        .in("id", chainIds);
      if (error) throw new Error(error.message);
    }
    return { renamed: chainIds.length };
  });

export const updateDayTaskDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; description: string | null; estMinutes?: number | null }) =>
    z
      .object({
        id: z.string().uuid(),
        description: z.string().max(2000).nullable(),
        estMinutes: z.number().int().min(1).max(1440).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: taskRow } = await supabase
      .from("day_tasks")
      .select("id, goal_id, task_date, description")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!taskRow) throw new Error("Task not found.");

    if (taskRow.task_date && taskRow.task_date < toISODate(new Date())) {
      throw new Error("Tasks from past days are locked and cannot be changed.");
    }

    if (taskRow.goal_id) {
      const { data: goalRow } = await supabase
        .from("goals")
        .select("status")
        .eq("id", taskRow.goal_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (goalRow?.status === "completed") {
        throw new Error("This task belongs to a completed goal and is locked.");
      }
    }

    // Re-serialise: keep existing estMinutes if caller didn't change it,
    // or use the new value if explicitly passed.
    const { estMinutes: existingEst } = parseTaskDescriptionServer(taskRow.description);
    const newEst = data.estMinutes !== undefined ? data.estMinutes : existingEst;
    const newDescription = formatTaskDescriptionServer(data.description ?? "", newEst);

    const { error } = await supabase
      .from("day_tasks")
      .update({ description: newDescription })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });


export const addDayTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { date: string; title: string; goalId?: string | null; subjectId?: string | null }) =>
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

export const completeDayTasksBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { date: string }) =>
    z.object({ date: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    if (data.date < toISODate(new Date())) {
      throw new Error("Tasks from past days are locked and cannot be modified.");
    }

    const { data: uncompleted, error: fetchErr } = await supabase
      .from("day_tasks")
      .select("id, goal_id")
      .eq("user_id", context.userId)
      .eq("task_date", data.date)
      .is("completed_at", null);

    if (fetchErr) throw new Error(fetchErr.message);
    if (!uncompleted || uncompleted.length === 0) {
      return { completedCount: 0, profile: null };
    }

    const goalIds = Array.from(new Set(uncompleted.map((t) => t.goal_id).filter(Boolean))) as string[];
    const lockedGoalIds = new Set<string>();
    if (goalIds.length > 0) {
      const { data: goalRows } = await supabase
        .from("goals")
        .select("id, status")
        .in("id", goalIds)
        .eq("user_id", context.userId);
      for (const g of goalRows ?? []) {
        if (g.status === "completed") lockedGoalIds.add(g.id);
      }
    }

    const eligibleIds = uncompleted
      .filter((t) => !t.goal_id || !lockedGoalIds.has(t.goal_id))
      .map((t) => t.id);

    if (eligibleIds.length > 0) {
      const nowISO = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from("day_tasks")
        .update({ completed_at: nowISO, progress_pct: 100 })
        .in("id", eligibleIds)
        .eq("user_id", context.userId);
      if (updateErr) throw new Error(updateErr.message);
    }

    const profile = await recomputeStats(supabase, context.userId);
    return { completedCount: eligibleIds.length, profile };
  });

export const reorderDayTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { date: string; orderedIds: string[] }) =>
      z
        .object({
          date: z.string(),
          orderedIds: z.array(z.string().uuid()),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    if (data.date < toISODate(new Date())) {
      throw new Error("Tasks from past days are locked.");
    }
    if (data.orderedIds.length === 0) return { ok: true };

    await Promise.all(
      data.orderedIds.map((id, idx) =>
        supabase
          .from("day_tasks")
          .update({ sort_order: (idx + 1) * 10 })
          .eq("id", id)
          .eq("user_id", context.userId),
      ),
    );

    return { ok: true };
  });

export const rescheduleDayTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; targetDate: string }) =>
      z
        .object({
          id: z.string().uuid(),
          targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: task, error: fetchErr } = await supabase
      .from("day_tasks")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!task) throw new Error("Task not found.");
    if (task.task_date < toISODate(new Date())) {
      throw new Error("Tasks from past days are locked.");
    }
    if (task.goal_id) {
      const { data: goal } = await supabase
        .from("goals")
        .select("status")
        .eq("id", task.goal_id)
        .maybeSingle();
      if (goal?.status === "completed") {
        throw new Error("This task is linked to a completed goal and cannot be rescheduled.");
      }
    }

    // Clean up any antecedent uncompleted copies in the same chain so no dangling
    // duplicates remain across past/present days.
    let chainQuery = supabase
      .from("day_tasks")
      .select("id")
      .eq("user_id", context.userId)
      .eq("title", task.title)
      .is("completed_at", null)
      .neq("id", task.id);

    if (task.goal_id) {
      chainQuery = chainQuery.eq("goal_id", task.goal_id);
    } else {
      chainQuery = chainQuery.is("goal_id", null);
    }

    if (task.routine_task_id) {
      chainQuery = chainQuery.eq("routine_task_id", task.routine_task_id);
    }

    const { data: relatedUncompleted } = await chainQuery;
    if (relatedUncompleted && relatedUncompleted.length > 0) {
      const idsToDelete = relatedUncompleted.map((r) => r.id);
      await supabase.from("day_tasks").delete().in("id", idsToDelete);
    }

    // Move the whole task to the target date and reset rollover counters so
    // rollover starts fresh from the new date.
    const { error: updateErr } = await supabase
      .from("day_tasks")
      .update({
        task_date: data.targetDate,
        rollover_count: 0,
        is_stale: false,
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);

    if (updateErr) throw new Error(updateErr.message);
    await recomputeStats(supabase, context.userId);
    return { ok: true, newDate: data.targetDate };
  });

/**
 * Read-only: returns per-ISO-week task stats (done / total) for all day_tasks
 * linked to a specific goal. Used to render the Goal History Trail mini chart.
 * Rollover copies all retain the same goal_id so they are naturally included.
 */
export const getGoalWeeklyProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { goalId: string }) =>
    z.object({ goalId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("day_tasks")
      .select("task_date, completed_at")
      .eq("user_id", context.userId)
      .eq("goal_id", data.goalId)
      .order("task_date", { ascending: true });

    if (!rows || rows.length === 0) return { weeks: [] as { weekStart: string; done: number; total: number }[] };

    // Group by Monday-week (same startOfWeek logic: Monday = day 0)
    const weekMap = new Map<string, { done: number; total: number }>();
    for (const row of rows) {
      const d = new Date(row.task_date + "T00:00:00");
      const day = (d.getDay() + 6) % 7; // Mon=0
      const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
      const weekKey = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
      const cur = weekMap.get(weekKey) ?? { done: 0, total: 0 };
      cur.total += 1;
      if (row.completed_at) cur.done += 1;
      weekMap.set(weekKey, cur);
    }

    const weeks = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, stats]) => ({ weekStart, ...stats }));

    return { weeks };
  });

export const copyWeekdayRoutines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { sourceWeekday: number; targetWeekday: number; overwriteTarget?: boolean }) =>
      z
        .object({
          sourceWeekday: z.number().int().min(0).max(6),
          targetWeekday: z.number().int().min(0).max(6),
          overwriteTarget: z.boolean().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: sourceTasks, error: srcErr } = await supabase
      .from("routine_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .eq("weekday", data.sourceWeekday)
      // Deterministic source order so clones get stable (i + 1) * 10 sort
      // values that mirror the source day's layout across all weekdays.
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (srcErr) throw new Error(srcErr.message);
    if (!sourceTasks || sourceTasks.length === 0) {
      return { copiedCount: 0 };
    }

    if (data.overwriteTarget) {
      await supabase
        .from("routine_tasks")
        .delete()
        .eq("user_id", context.userId)
        .eq("weekday", data.targetWeekday);
    }

    const clones = sourceTasks.map((t, i) => ({
      user_id: context.userId,
      weekday: data.targetWeekday,
      title: t.title,
      sort_order: (i + 1) * 10,
      goal_id: t.goal_id,
      subject_id: t.subject_id,
      is_active: t.is_active,
    }));

    const { error: insErr } = await supabase.from("routine_tasks").insert(clones);
    if (insErr) throw new Error(insErr.message);

    return { copiedCount: clones.length };
  });


export const reorderRoutineTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { orderedIds: string[] }) =>
      z
        .object({
          orderedIds: z.array(z.string().uuid()).min(1),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    // Fetch the referenced rows to learn which logical tasks (by clean title)
    // they correspond to. Reordering is title-based and GLOBAL: routine tasks
    // are separate rows per weekday, so a manual order must be written to every
    // weekday's row for the same task to keep all days rendering identically.
    const { data: rows, error: fetchErr } = await supabase
      .from("routine_tasks")
      .select("id, title")
      .eq("user_id", context.userId)
      .in("id", data.orderedIds);
    if (fetchErr) throw new Error(fetchErr.message);

    // Preserve the caller's ordering: map each ordered id to its clean title,
    // de-duplicating while keeping first occurrence.
    const titleById = new Map(
      (rows ?? []).map((r) => [r.id, parseRoutineTitle(r.title).cleanTitle.trim().toLowerCase()]),
    );
    const orderedTitles: string[] = [];
    for (const id of data.orderedIds) {
      const t = titleById.get(id);
      if (t && !orderedTitles.includes(t)) orderedTitles.push(t);
    }
    if (orderedTitles.length === 0) return { ok: true };

    // Positional values (10, 20, 30, ...) for the ordered set. Any task NOT in
    // the reordered cell keeps its existing sort_order (typically 0), which
    // still sorts before these — creation-order fallback remains deterministic.
    const orderByTitle = new Map(
      orderedTitles.map((t, i) => [t, (i + 1) * 10]),
    );

    // Update every row (all weekdays) whose parsed clean title matches one of
    // the reordered tasks. Titles carry structured prefixes
    // ("[slot|category|emoji|color|habit|task] CleanTitle"), so match on the
    // parsed clean title in JS instead of fragile SQL pattern matching.
    const { data: allRows, error: allErr } = await supabase
      .from("routine_tasks")
      .select("id, title")
      .eq("user_id", context.userId);
    if (allErr) throw new Error(allErr.message);

    await Promise.all(
      (allRows ?? [])
        .map((r) => {
          const t = parseRoutineTitle(r.title).cleanTitle.trim().toLowerCase();
          const sortOrder = orderByTitle.get(t);
          return sortOrder == null
            ? null
            : supabase.from("routine_tasks").update({ sort_order: sortOrder }).eq("id", r.id);
        })
        .filter(Boolean),
    );

    return { ok: true };
  });

export const getRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("routine_tasks")
      .select("*")
      .eq("user_id", context.userId)
      .order("weekday", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
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
    // New tasks append at the END of their cell (max sort_order + 10) instead
    // of tying everything at 0, so user-defined order is never reshuffled by
    // alphabetical or creation-order fallbacks.
    const { data: maxRow } = await context.supabase
      .from("routine_tasks")
      .select("sort_order")
      .eq("user_id", context.userId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextSort = (maxRow?.sort_order ?? 0) + 10;

    const rows = data.items.map((item) => ({
      user_id: context.userId,
      weekday: item.weekday,
      title: item.title.trim(),
      goal_id: item.goalId ?? null,
      subject_id: item.subjectId ?? null,
      sort_order: item.sortOrder ?? nextSort++,
      is_active: item.isActive ?? true,
    }));
    await context.supabase.from("routine_tasks").insert(rows);
    return { ok: true };
  });

export const clearAllRoutineTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase.from("routine_tasks").delete().eq("user_id", context.userId);
    return { ok: true };
  });

/**
 * Progress for a habit linked to a goal, windowed from that specific link's
 * goal_habit_links.created_at (not the habit's or the goal's creation date).
 *
 * Duration-limited (durationDays set): day-count mode. The window is
 * [link_created_at, link_created_at + duration_days). Progress is distinct
 * days logged in that window / duration_days, shown as "X/Y days" and that
 * same fraction as the percentage. On-track = every day in the window was
 * logged (daysLogged === durationDays).
 *
 * Unlimited (durationDays null): weekly-bucket mode (unchanged). A week
 * "counts" when the habit's log count for that week is >= its target_per_week;
 * hit-rate is weeks met / weeks total through the current week.
 */
type HabitLinkWindow = { createdAt: string; durationDays: number | null };

function computeHabitProgress(
  linkCreatedAt: string,
  durationDays: number | null,
  habit: { id: string; title: string; target_per_week: number },
  done: Set<string> | undefined,
): GoalHabitStat {
  const created = parseISODate(linkCreatedAt.slice(0, 10));

  // ---- Duration-limited: day-count mode ----
  if (durationDays != null) {
    const windowStartISO = toISODate(created);
    const windowEndISO = toISODate(addDays(created, durationDays - 1));
    let daysLogged = 0;
    if (done) {
      for (const d of done) {
        if (d >= windowStartISO && d <= windowEndISO) daysLogged += 1;
      }
    }
    return {
      habitId: habit.id,
      title: parseHabitTitle(habit.title).displayTitle || habit.title,
      targetPerWeek: habit.target_per_week,
      // weeksMet/weeksTotal are repurposed to daysLogged/durationDays so the
      // shared on-track rule and snapshot mapping stay uniform across modes.
      weeksTotal: durationDays,
      weeksMet: daysLogged,
      hitRate: durationDays > 0 ? (daysLogged / durationDays) * 100 : 0,
      durationDays,
      daysLogged,
    };
  }

  // ---- Unlimited: weekly-bucket mode (unchanged) ----
  const weekStarts: string[] = [];
  const createdISO = toISODate(created);
  let cur = startOfWeek(created);
  let end = startOfWeek(new Date());
  // Optional bounded window: track for duration_days days starting from the
  // link's created_at. The last tracked day is created_at + duration_days - 1;
  // enumeration stops at the week containing it and never runs past the
  // current week (no phantom future weeks).
  const windowRange: [string, string] | null =
    durationDays != null
      ? [toISODate(created), toISODate(addDays(created, durationDays - 1))]
      : null;
  if (windowRange) {
    const windowEndWeek = startOfWeek(parseISODate(windowRange[1]));
    if (windowEndWeek < end) end = windowEndWeek;
  }
  while (cur <= end) {
    weekStarts.push(toISODate(cur));
    cur = addDays(cur, 7);
  }
  const weeksTotal = weekStarts.length;
  const thisWeekStart = weekStarts[weekStarts.length - 1];
  let weeksMet = 0;
  // Partial credit for the last enumerated week — the current in-progress week
  // for an open-ended window, or the final tracked week of a closed duration
  // window: fraction of the weekly target actually logged (e.g. 1/7 ≈ 14%),
  // capped at 1 so over-logging can't exceed full credit.
  let partial = 0;
  for (const ws of weekStarts) {
    const weekEnd = toISODate(addDays(parseISODate(ws), 6));
    let count = 0;
    if (done) {
      for (const d of done) {
        // Bounded window: logs outside [created, created + duration_days) do
        // not count toward this goal's tracking of the habit.
        if (windowRange && (d < windowRange[0] || d > windowRange[1])) continue;
        // Never count a log before the link's created_at date. The first
        // calendar week in weekly-bucket mode starts at the week containing
        // created_at, which can precede the link — without this guard pre-link
        // logs in that same week would count (day-count mode already filters
        // to [created, created + duration_days) so it is unaffected).
        if (d < createdISO) continue;
        if (d >= ws && d <= weekEnd) count += 1;
        if (count >= habit.target_per_week) break;
      }
    }
    if (count >= habit.target_per_week) {
      weeksMet += 1;
    } else if (ws === thisWeekStart && count > 0) {
      partial = Math.min(count / habit.target_per_week, 1);
    }
  }
  const hitRate = weeksTotal > 0 ? Math.round(((weeksMet + partial) / weeksTotal) * 100) : 0;
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
  linkedHabitLinks: Map<string, HabitLinkWindow>,
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

  const linkedStats: GoalHabitStat[] = linked.map((h) => {
    const link = linkedHabitLinks.get(h.id)!;
    return computeHabitProgress(link.createdAt, link.durationDays, h, logsByHabit.get(h.id));
  });

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
  // row is keyed on (goal_id, habit_id)). Each link carries its own created_at
  // (the hit-rate window start for that pair) and an optional duration_days cap.
  const habitLinksByGoal = new Map<string, Map<string, HabitLinkWindow>>();
  const { data: linkRows } = await supabase
    .from("goal_habit_links")
    .select("goal_id, habit_id, created_at, duration_days")
    .in(
      "goal_id",
      goals.map((g) => g.id),
    );
  for (const l of linkRows ?? []) {
    const byHabit = habitLinksByGoal.get(l.goal_id) ?? new Map<string, HabitLinkWindow>();
    byHabit.set(l.habit_id, { createdAt: l.created_at, durationDays: l.duration_days });
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
      .in(
        "habit_id",
        habits.map((h) => h.id),
      );
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
    const progress = computeGoalProgress(
      { total: 0, done: 0 },
      habits,
      logsByHabit,
      habitLinksByGoal.get(g.id) ?? new Map<string, HabitLinkWindow>(),
    );
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

    // Rollover-superseded rows must not count toward a goal's task total/done:
    // only the newest copy of each rollover chain contributes, so a chain that
    // rolled N times counts as ONE task, not N. Detection lives in the shared
    // getSupersededRolloverIds — the exact same chain-linking the client uses
    // for the "Completed late" badge and the Goal Tasks list collapse,
    // including the completion bridge that reconnects chains whose identity
    // was broken by manual re-creation (rollover_count reset to 0) — so the
    // server's counting and the client's display can never disagree.
    const supersededIds = getSupersededRolloverIds(linkedRows);

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
    // created_at — not the goal's — optionally bounded by the link's
    // duration_days. The flattened habit-id record is also returned to the
    // client so the goal detail view's Linked Habits list reads the join table
    // instead of the old single-FK column.
    const habitLinksByGoal = new Map<string, Map<string, HabitLinkWindow>>();
    if (goalRows.length > 0) {
      const { data: linkRows } = await supabase
        .from("goal_habit_links")
        .select("goal_id, habit_id, created_at, duration_days")
        .in(
          "goal_id",
          goalRows.map((gr) => gr.id),
        );
      for (const l of linkRows ?? []) {
        const byHabit = habitLinksByGoal.get(l.goal_id) ?? new Map<string, HabitLinkWindow>();
        byHabit.set(l.habit_id, { createdAt: l.created_at, durationDays: l.duration_days });
        habitLinksByGoal.set(l.goal_id, byHabit);
      }
    }
    const habitIdsByGoalRecord: Record<string, string[]> = {};
    for (const [gid, links] of habitLinksByGoal) habitIdsByGoalRecord[gid] = [...links.keys()];
    const habitDurationsByGoal: Record<
      string,
      Record<string, { durationDays: number | null; createdAt: string }>
    > = {};
    for (const [gid, links] of habitLinksByGoal) {
      const perHabit: Record<string, { durationDays: number | null; createdAt: string }> = {};
      for (const [habitId, link] of links) {
        perHabit[habitId] = { durationDays: link.durationDays, createdAt: link.createdAt };
      }
      habitDurationsByGoal[gid] = perHabit;
    }
    const logsByHabit = new Map<string, Set<string>>();
    if (habits.length > 0) {
      const { data: logRows } = await supabase
        .from("habit_logs")
        .select("habit_id, log_date")
        .in(
          "habit_id",
          habits.map((h) => h.id),
        );
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
        habitLinksByGoal.get(g.id) ?? new Map<string, HabitLinkWindow>(),
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
        .in(
          "goal_id",
          goalRows.map((g) => g.id),
        );
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
        if (!s) return lh;
        const restored = {
          ...lh,
          weeksMet: s.weeksOnTarget,
          weeksTotal: s.totalWeeks,
          hitRate: s.hitRatePct,
        };
        // Duration-limited links store daysLogged/durationDays in the snapshot's
        // weeks_on_target/total_weeks; restore the day count for the display.
        return lh.durationDays != null ? { ...restored, daysLogged: s.weeksOnTarget } : restored;
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
      habitDurationsByGoal,
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

/**
 * Rename a goal's title. A goal's identity is its id — nothing in the rollover,
 * dedupe or progress logic keys off goals.title (only day-task/routine-task
 * titles are identity-bearing, via taskKey / goalLinkKey) — so a simple single
 * row update is safe. Completed goals are locked, consistent with
 * toggleDayTask / renameDayTask / the UI's completed-goal treatment.
 */
export const renameGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; title: string }) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const newTitle = data.title.trim();
    if (!newTitle) throw new Error("Goal title cannot be empty.");

    const { data: goalRow } = await supabase
      .from("goals")
      .select("id, status")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!goalRow) throw new Error("Goal not found.");
    if (goalRow.status === "completed") {
      throw new Error("Completed goals are locked and cannot be renamed.");
    }

    const { error } = await supabase.from("goals").update({ title: newTitle }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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
    await supabase.from("routine_tasks").delete().in("id", data.ids).eq("user_id", context.userId);
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
  .inputValidator((input: { id: string; status: string; newTargetDate?: string | null }) =>
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

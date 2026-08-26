import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ensureProfile,
  loadHistory,
  loadDay,
  loadWeek,
  recomputeStats,
} from "./tracker.server";

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
    await (context.supabase as any)
      .from("day_tasks")
      .update({ completed_at: data.completed ? new Date().toISOString() : null })
      .eq("id", data.id);
    const profile = await recomputeStats(context.supabase as any, context.userId);
    return { profile };
  });

export const addDayTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { date: string; title: string; goalId?: string | null }) =>
    z
      .object({
        date: z.string(),
        title: z.string().min(1).max(200),
        goalId: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await (context.supabase as any)
      .from("day_tasks")
      .insert({
        user_id: context.userId,
        task_date: data.date,
        title: data.title.trim(),
        source: "oneoff",
        goal_id: data.goalId ?? null,
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
  .inputValidator((input: { weekday: number; title: string; goalId?: string | null }) =>
    z
      .object({
        weekday: z.number().int().min(0).max(6),
        title: z.string().min(1).max(200),
        goalId: z.string().nullable().optional(),
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

export const getGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as any;
    const { data: goals } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    const { data: linked } = await supabase
      .from("day_tasks")
      .select("goal_id, completed_at")
      .eq("user_id", context.userId)
      .not("goal_id", "is", null);

    const stats: Record<string, { total: number; done: number }> = {};
    for (const row of (linked ?? []) as any[]) {
      const e = stats[row.goal_id] ?? { total: 0, done: 0 };
      e.total += 1;
      if (row.completed_at) e.done += 1;
      stats[row.goal_id] = e;
    }
    return { goals: goals ?? [], stats };
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
    await supabase.from("goals").insert({ ...payload, user_id: context.userId });
    return { ok: true };
  });

export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await (context.supabase as any).from("goals").delete().eq("id", data.id);
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

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { loadHabits } from "./habits.server";

export const getHabits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekStart: string }) =>
    z.object({ weekStart: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    return loadHabits(context.supabase, context.userId, data.weekStart);
  });

export const addHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { title: string; targetPerWeek: number }) =>
    z
      .object({ title: z.string().min(1).max(120), targetPerWeek: z.number().int().min(1).max(7) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await context.supabase.from("habits").insert({
      user_id: context.userId,
      title: data.title.trim(),
      target_per_week: data.targetPerWeek,
    });
    return { ok: true };
  });

export const deleteHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase.from("habits").delete().eq("id", data.id);
    return { ok: true };
  });

export const updateHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; title?: string; targetPerWeek?: number }) =>
      z
        .object({
          id: z.string(),
          title: z.string().min(1).max(120).optional(),
          targetPerWeek: z.number().int().min(1).max(7).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const patch: TablesUpdate<"habits"> = {};
    if (data.title !== undefined) {
      // Goal membership lives in goal_habit_links now, so titles never carry a
      // "[goal:<uuid>]" prefix — strip the legacy one if still present.
      patch.title = data.title.trim().replace(/^\[goal:[^\]]+\]\s*/, "");
    }
    if (data.targetPerWeek !== undefined) patch.target_per_week = data.targetPerWeek;
    if (Object.keys(patch).length > 0) {
      await supabase.from("habits").update(patch).eq("id", data.id).eq("user_id", context.userId);
    }
    return { ok: true };
  });

export const toggleHabitDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { habitId: string; date: string; done: boolean }) =>
    z.object({ habitId: z.string(), date: z.string(), done: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    if (data.done) {
      await supabase
        .from("habit_logs")
        .upsert(
          { user_id: context.userId, habit_id: data.habitId, log_date: data.date },
          { onConflict: "habit_id,log_date" },
        );
    } else {
      await supabase
        .from("habit_logs")
        .delete()
        .eq("habit_id", data.habitId)
        .eq("log_date", data.date);
    }
    return { ok: true };
  });

export const linkHabitToGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { habitId: string; goalId: string }) =>
      z.object({ habitId: z.string(), goalId: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    // Many-to-many: one habit may be linked to several goals. Goal ownership is
    // enforced by RLS on goal_habit_links (rows are scoped through the owning
    // goal's user_id); the habit itself must belong to the caller.
    const { data: habit } = await supabase
      .from("habits")
      .select("id")
      .eq("id", data.habitId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!habit) throw new Error("Habit not found");
    // Reset-on-conflict: if a row for this (goal, habit) pair already exists —
    // e.g. because an unlink delete was a silent no-op — a default upsert merge
    // (ON CONFLICT DO UPDATE) only writes the columns present in the payload.
    // By explicitly including duration_days: null and created_at: now, both a
    // fresh insert and a merge-on-conflict converge to the same "genuinely new
    // link" state: the tracking window and "Tracked until" date restart from
    // today instead of carrying over the pre-existing row's values.
    const { error } = await supabase.from("goal_habit_links").upsert(
      {
        goal_id: data.goalId,
        habit_id: data.habitId,
        duration_days: null,
        created_at: new Date().toISOString(),
      },
      { onConflict: "goal_id,habit_id" },
    );
    if (error) throw new Error(`Failed to link habit to goal: ${error.message}`);
    return { ok: true };
  });

export const unlinkHabitFromGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { habitId: string; goalId: string }) =>
      z.object({ habitId: z.string(), goalId: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Remove just this (goal, habit) pair — other goals sharing the habit are
    // unaffected.
    const { error } = await context.supabase
      .from("goal_habit_links")
      .delete()
      .eq("goal_id", data.goalId)
      .eq("habit_id", data.habitId);
    // Surface DB failures instead of silently reporting a successful unlink
    // (PostgREST returns 200 with zero affected rows when RLS filters the
    // row out, so absence of an error does not prove the row was removed — but
    // a real DB error must not be swallowed).
    if (error) throw new Error(`Failed to unlink habit from goal: ${error.message}`);
    return { ok: true };
  });

export const updateHabitTrackingDuration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { goalId: string; habitId: string; durationDays: number | null }) =>
      z
        .object({
          goalId: z.string(),
          habitId: z.string(),
          durationDays: z.number().int().min(1).max(3650).nullable(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Scoped update: touches duration_days on the exact (goal_id, habit_id)
    // link row only. It cannot create or delete links, and cannot affect the
    // habit's links to any other goal. RLS scopes the row to the owning goal.
    const patch: TablesUpdate<"goal_habit_links"> = { duration_days: data.durationDays };
    await context.supabase
      .from("goal_habit_links")
      .update(patch)
      .eq("goal_id", data.goalId)
      .eq("habit_id", data.habitId);
    return { ok: true };
  });


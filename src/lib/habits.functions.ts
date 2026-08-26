import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadHabits } from "./habits.server";

export const getHabits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekStart: string }) =>
    z.object({ weekStart: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    return loadHabits(context.supabase as any, context.userId, data.weekStart);
  });

export const addHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { title: string; targetPerWeek: number }) =>
    z
      .object({ title: z.string().min(1).max(120), targetPerWeek: z.number().int().min(1).max(7) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await (context.supabase as any).from("habits").insert({
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
    await (context.supabase as any).from("habits").delete().eq("id", data.id);
    return { ok: true };
  });

export const toggleHabitDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { habitId: string; date: string; done: boolean }) =>
    z.object({ habitId: z.string(), date: z.string(), done: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
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

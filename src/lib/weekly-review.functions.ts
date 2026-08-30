import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getReviewPromptStatus as loadReviewPromptStatus,
  getWeeklyReview as loadWeeklyReview,
  listWeeklyReviews as loadListWeeklyReviews,
  markReviewSeen as markReviewSeenRow,
  saveWeeklyReflection as saveWeeklyReflectionRow,
} from "./weekly-review.server";

export const getWeeklyReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekStart: string }) => z.object({ weekStart: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const review = await loadWeeklyReview(context.supabase as any, context.userId, data.weekStart);
    return { review };
  });

export const listWeeklyReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const weekStarts = await loadListWeeklyReviews(context.supabase as any, context.userId);
    return { weekStarts };
  });

export const getReviewPromptStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const status = await loadReviewPromptStatus(context.supabase as any, context.userId);
    return { status };
  });

export const markReviewSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekStart: string }) => z.object({ weekStart: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await markReviewSeenRow(context.supabase as any, context.userId, data.weekStart);
    return { ok: true };
  });

export const saveWeeklyReflection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { weekStart: string; reflectionText: string }) =>
    z.object({ weekStart: z.string(), reflectionText: z.string().max(300) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await saveWeeklyReflectionRow(context.supabase as any, context.userId, data.weekStart, data.reflectionText);
    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  countSubjectUsage,
  deleteSubjectRow,
  getSubjectBreakdown as loadSubjectBreakdown,
  insertSubject,
  listSubjects,
  updateSubjectRow,
} from "./subjects.server";

export const getSubjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const subjects = await listSubjects(context.supabase, context.userId);
    return { subjects };
  });

export const createSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; color: string }) =>
    z.object({ name: z.string().min(1).max(120), color: z.string().min(1).max(40) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const subject = await insertSubject(context.supabase, context.userId, data.name, data.color);
    return { subject };
  });

export const updateSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; name?: string; color?: string }) =>
    z
      .object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        color: z.string().min(1).max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: { name?: string; color?: string } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.color !== undefined) patch.color = data.color;
    const subject = await updateSubjectRow(context.supabase, context.userId, data.id, patch);
    return { subject };
  });

export const checkSubjectUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const usage = await countSubjectUsage(context.supabase, context.userId, data.id);
    return { usage };
  });

export const deleteSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await deleteSubjectRow(context.supabase, context.userId, data.id);
    return { ok: true };
  });

export const getSubjectBreakdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fromDate: string; toDate?: string }) =>
    z.object({ fromDate: z.string(), toDate: z.string().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const entries = await loadSubjectBreakdown(
      context.supabase,
      context.userId,
      data.fromDate,
      data.toDate,
    );
    return { entries };
  });
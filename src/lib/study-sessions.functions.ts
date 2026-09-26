import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getActiveSession as loadActiveSession,
  startStudySession as startSessionRow,
  stopStudySession as stopSessionRow,
} from "./study-sessions.server";
import { STUDY_SESSION_MODES, type StudySessionMode } from "./study-sessions-shared";

/** The caller's running timer, if any (`session: null` when idle). */
export const getActiveStudySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const session = await loadActiveSession(context.supabase, context.userId);
    return { session };
  });

/**
 * Start a timer. Passing no input starts a default Pomodoro; when a session is
 * already running its row is returned instead of starting a second timer.
 */
export const startStudySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (
      input:
        | {
            subjectId?: string | null;
            goalId?: string | null;
            mode?: StudySessionMode;
            targetSeconds?: number | null;
          }
        | undefined,
    ) =>
      z
        .object({
          subjectId: z.string().uuid().nullable().optional(),
          goalId: z.string().uuid().nullable().optional(),
          mode: z.enum(STUDY_SESSION_MODES).optional(),
          targetSeconds: z.number().int().min(1).max(86400).nullable().optional(),
        })
        .optional()
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const session = await startSessionRow(context.supabase, context.userId, {
      mode: data?.mode,
      subjectId: data?.subjectId ?? null,
      goalId: data?.goalId ?? null,
      targetSeconds: data?.targetSeconds ?? null,
    });
    return { session };
  });

/** Stop a timer (the active one by default, or `sessionId` when given). */
export const stopStudySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { sessionId?: string | null; notes?: string | null } | undefined) =>
    z
      .object({
        sessionId: z.string().uuid().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .optional()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const session = await stopSessionRow(context.supabase, context.userId, {
      sessionId: data?.sessionId ?? null,
      notes: data?.notes,
    });
    return { session };
  });

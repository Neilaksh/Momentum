import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getActiveSession as loadActiveSession,
  listFinishedSessionsSince,
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
            mode?: StudySessionMode;
            targetSeconds?: number | null;
          }
        | undefined,
    ) =>
      z
        .object({
          subjectId: z.string().uuid().nullable().optional(),
          mode: z.enum(STUDY_SESSION_MODES).optional(),
          targetSeconds: z.number().int().min(1).max(86400).nullable().optional(),
        })
        .optional()
        .parse(input),
  )
  .handler(async ({ data, context }) =>
    startSessionRow(context.supabase, context.userId, {
      mode: data?.mode,
      subjectId: data?.subjectId ?? null,
      targetSeconds: data?.targetSeconds ?? null,
    }),
  );

/** Stop a timer (the active one by default, or `sessionId` when given). */
export const stopStudySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (
      input:
        | {
            sessionId?: string | null;
            notes?: string | null;
          }
        | undefined,
    ) =>
      z
        .object({
          sessionId: z.string().uuid().nullable().optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .optional()
        .parse(input),
  )
  .handler(async ({ data, context }) =>
    stopSessionRow(context.supabase, context.userId, {
      sessionId: data?.sessionId ?? null,
      notes: data?.notes,
    }),
  );

/**
 * Finished sessions from the start of the caller's week, used to mark subjects on
 * the Subjects tab. `weekStartIso` is the local Monday 00:00 as an ISO instant so
 * the week boundary is the caller's, not the server's.
 */
export const getStudyWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { weekStartIso: string }) =>
    z.object({ weekStartIso: z.string().min(1).max(40) }).parse(input),
  )
  .handler(async ({ data, context }) => ({
    sessions: await listFinishedSessionsSince(context.supabase, context.userId, data.weekStartIso),
  }));

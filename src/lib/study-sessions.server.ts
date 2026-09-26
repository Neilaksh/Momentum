import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudySession, StudySessionMode } from "./study-sessions-shared";
import type { Database, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

/** Input for starting a timer — everything is optional, defaults to a Pomodoro. */
export type StartStudySessionInput = {
  mode?: StudySessionMode | undefined;
  subjectId?: string | null | undefined;
  goalId?: string | null | undefined;
  targetSeconds?: number | null | undefined;
};

/** Input for stopping a timer. */
export type StopStudySessionInput = {
  /** Explicit session to finish; defaults to the caller's active session. */
  sessionId?: string | null | undefined;
  /** Optional note saved alongside the finished session. */
  notes?: string | null | undefined;
};

/**
 * The caller's active (unfinished) session, if any. Newest first and capped at
 * one row so a legacy duplicate can never make this read ambiguous.
 */
export async function getActiveSession(supabase: DB, userId: string): Promise<StudySession | null> {
  const { data, error } = await supabase
    .from("study_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the active study session: ${error.message}`);
  // The generated `mode` column is `string`; the table's CHECK constraint
  // narrows it to StudySessionMode.
  return (data as StudySession | null) ?? null;
}

/**
 * Start a timer. Idempotent by design: when the caller already has an active
 * session it is returned untouched, so a double-tap, a refresh or two open
 * tabs can never produce two running timers. study_sessions_one_active_idx
 * backstops the same rule at the database level.
 */
export async function startStudySession(
  supabase: DB,
  userId: string,
  input: StartStudySessionInput = {},
): Promise<StudySession> {
  const active = await getActiveSession(supabase, userId);
  if (active) return active;

  const row: TablesInsert<"study_sessions"> = {
    user_id: userId,
    mode: input.mode ?? "pomodoro",
    subject_id: input.subjectId ?? null,
    goal_id: input.goalId ?? null,
    target_seconds: input.targetSeconds ?? null,
  };

  const { data, error } = await supabase
    .from("study_sessions")
    .insert(row)
    .select("*")
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation: a concurrent start won the race between the
    // read above and this insert, so surface that session instead of failing.
    if (error.code === "23505") {
      const raced = await getActiveSession(supabase, userId);
      if (raced) return raced;
    }
    throw new Error(`Failed to start the study session: ${error.message}`);
  }
  if (!data) throw new Error("Failed to start the study session: no row returned.");
  return data as StudySession;
}

/**
 * Finish a session and stamp its duration. Idempotent: stopping an
 * already-finished session returns it unchanged (keeping the recorded
 * duration), and a session that no longer exists returns null.
 */
export async function stopStudySession(
  supabase: DB,
  userId: string,
  input: StopStudySessionInput = {},
): Promise<StudySession | null> {
  const session = input.sessionId
    ? await getSession(supabase, userId, input.sessionId)
    : await getActiveSession(supabase, userId);
  if (!session) return null;
  // Already stopped (retry or stale client state) — never rewrite the timing.
  if (session.ended_at) return session;

  const endedAt = new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - new Date(session.started_at).getTime()) / 1000),
  );

  const patch: TablesUpdate<"study_sessions"> = {
    ended_at: endedAt.toISOString(),
    duration_seconds: durationSeconds,
  };
  if (input.notes !== undefined) {
    const notes = input.notes?.trim();
    patch.notes = notes ? notes : null;
  }

  const { data, error } = await supabase
    .from("study_sessions")
    .update(patch)
    .eq("id", session.id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to stop the study session: ${error.message}`);
  // Only reachable if the row was deleted concurrently: report "nothing to
  // stop" rather than inventing a finished session.
  return (data as StudySession | null) ?? null;
}

/** One session by id, scoped to the owning user. */
async function getSession(supabase: DB, userId: string, id: string): Promise<StudySession | null> {
  const { data, error } = await supabase
    .from("study_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the study session: ${error.message}`);
  return (data as StudySession | null) ?? null;
}

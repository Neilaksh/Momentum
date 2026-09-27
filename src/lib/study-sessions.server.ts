import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudySession, StudySessionMode, StudySessionRow } from "./study-sessions-shared";
import type { Database, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

/** Input for starting a timer — everything is optional, defaults to a Pomodoro. */
export type StartStudySessionInput = {
  mode?: StudySessionMode | undefined;
  subjectId?: string | null | undefined;
  targetSeconds?: number | null | undefined;
};

/** Input for stopping a timer. */
export type StopStudySessionInput = {
  /** Explicit session to finish; defaults to the caller's active session. */
  sessionId?: string | null | undefined;
  /** Optional note saved alongside the finished session. */
  notes?: string | null | undefined;
};

export type StopStudySessionResult = {
  session: StudySession | null;
};

export type StartStudySessionResult = {
  session: StudySession;
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
): Promise<StartStudySessionResult> {
  const active = await getActiveSession(supabase, userId);
  if (active) return { session: active };

  const row: TablesInsert<"study_sessions"> = {
    user_id: userId,
    mode: input.mode ?? "pomodoro",
    subject_id: input.subjectId ?? null,
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
      if (raced) return { session: raced };
    }
    throw new Error(`Failed to start the study session: ${error.message}`);
  }
  if (!data) throw new Error("Failed to start the study session: no row returned.");
  return { session: data as StudySession };
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
): Promise<StopStudySessionResult> {
  const session = input.sessionId
    ? await getSession(supabase, userId, input.sessionId)
    : await getActiveSession(supabase, userId);
  if (!session) return { session: null };
  // Already stopped (retry or stale client state) — never rewrite the timing.
  if (session.ended_at) return { session };

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

  return { session: (data as StudySession | null) ?? null };
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

/** Columns the Subjects tab buckets study time from — nothing else is needed. */
const STUDY_WEEK_COLUMNS = "id, subject_id, started_at, ended_at, duration_seconds, mode";

/**
 * Every finished session that started on or after `fromIso`, oldest first.
 *
 * `fromIso` is a full ISO instant (not a plain date) so the caller's LOCAL week
 * boundary survives the round trip: the Subjects tab asks for "since Monday
 * 00:00 my time" and the server compares that instant against started_at.
 * Unfinished timers are excluded — a running block has no duration to credit yet.
 */
export async function listFinishedSessionsSince(
  supabase: DB,
  userId: string,
  fromIso: string,
): Promise<StudySessionRow[]> {
  const { data, error } = await supabase
    .from("study_sessions")
    .select(STUDY_WEEK_COLUMNS)
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .gte("started_at", fromIso)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`Failed to load this week's study sessions: ${error.message}`);
  return (data ?? []) as unknown as StudySessionRow[];
}

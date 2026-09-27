import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudySession, StudySessionMode } from "./study-sessions-shared";
import type { Database, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { parseTaskDescription } from "./tracker-shared";
import { recomputeStats } from "./tracker.server";

type DB = SupabaseClient<Database>;

/**
 * True when PostgREST rejected a write because it does not know the
 * study_sessions.task_id column, i.e. the "add study sessions task id"
 * migration has not been applied to this database yet. Both PostgREST
 * spellings are covered:
 *
 *   42703    -> column study_sessions.task_id does not exist
 *   PGRST204 -> Could not find the 'task_id' column of 'study_sessions' in the
 *               schema cache
 *
 * The code check keeps an unrelated failure (23503, e.g. the task was deleted
 * between selecting it and starting) from being mistaken for a missing column.
 */
function isMissingTaskIdColumnError(code: string | null | undefined, message: string): boolean {
  if (code !== "42703" && code !== "PGRST204") return false;
  return /task_id/i.test(message);
}

/** Input for starting a timer — everything is optional, defaults to a Pomodoro. */
export type StartStudySessionInput = {
  mode?: StudySessionMode | undefined;
  subjectId?: string | null | undefined;
  goalId?: string | null | undefined;
  taskId?: string | null | undefined;
  targetSeconds?: number | null | undefined;
};

/** Input for stopping a timer. */
export type StopStudySessionInput = {
  /** Explicit session to finish; defaults to the caller's active session. */
  sessionId?: string | null | undefined;
  /** Optional note saved alongside the finished session. */
  notes?: string | null | undefined;
  /** If true, mark linked task as completed upon stopping. */
  markTaskComplete?: boolean | undefined;
};

export type StopStudySessionResult = {
  session: StudySession | null;
  taskUpdated?: {
    id: string;
    title: string;
    oldProgressPct: number;
    newProgressPct: number;
    deltaPct: number;
    completed: boolean;
  } | null;
};

/**
 * Result of starting a timer. `taskLinkSkipped` mirrors `daysOffSynced: false`
 * in tracker.functions.ts: when a database has no study_sessions.task_id column
 * yet the session still starts, but the requested task link (and with it the
 * task's progress update) is dropped, and the client can say why.
 */
export type StartStudySessionResult = {
  session: StudySession;
  taskLinkSkipped: boolean;
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
 *
 * The returned `taskLinkSkipped` is false for the idempotent path (nothing new
 * was written) and true only when a requested task link could not be stored.
 */
export async function startStudySession(
  supabase: DB,
  userId: string,
  input: StartStudySessionInput = {},
): Promise<StartStudySessionResult> {
  const active = await getActiveSession(supabase, userId);
  if (active) return { session: active, taskLinkSkipped: false };

  let subjectId = input.subjectId ?? null;
  let goalId = input.goalId ?? null;
  const taskId = input.taskId ?? null;

  // If a task is selected and subjectId/goalId are not provided, inherit them
  if (taskId && (!subjectId || !goalId)) {
    const { data: taskRow } = await supabase
      .from("day_tasks")
      .select("subject_id, goal_id")
      .eq("id", taskId)
      .eq("user_id", userId)
      .maybeSingle();
    if (taskRow) {
      if (!subjectId && taskRow.subject_id) subjectId = taskRow.subject_id;
      if (!goalId && taskRow.goal_id) goalId = taskRow.goal_id;
    }
  }

  const row: TablesInsert<"study_sessions"> = {
    user_id: userId,
    mode: input.mode ?? "pomodoro",
    subject_id: subjectId,
    goal_id: goalId,
    target_seconds: input.targetSeconds ?? null,
  };
  // task_id is only named when there is a link to store, so a database without
  // the task_id migration can still start untagged sessions normally.
  if (taskId) row.task_id = taskId;

  const insertRow = (payload: TablesInsert<"study_sessions">) =>
    supabase.from("study_sessions").insert(payload).select("*").maybeSingle();

  let taskLinkSkipped = false;
  let result = await insertRow(row);

  // The database does not know study_sessions.task_id yet: retry without the
  // link so the timer still starts (goal/subject were inherited above) and
  // report the dropped link instead of failing the whole start request.
  if (result.error && isMissingTaskIdColumnError(result.error.code, result.error.message)) {
    const unlinkedRow = { ...row };
    delete unlinkedRow.task_id;
    result = await insertRow(unlinkedRow);
    taskLinkSkipped = !result.error;
  }

  const { data, error } = result;

  if (error) {
    // 23505 = unique_violation: a concurrent start won the race between the
    // read above and this insert, so surface that session instead of failing.
    if (error.code === "23505") {
      const raced = await getActiveSession(supabase, userId);
      if (raced) return { session: raced, taskLinkSkipped: false };
    }
    throw new Error(`Failed to start the study session: ${error.message}`);
  }
  if (!data) throw new Error("Failed to start the study session: no row returned.");
  return { session: data as StudySession, taskLinkSkipped };
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

  const savedSession = (data as StudySession | null) ?? null;

  // If a task was linked, update its progress
  let taskUpdated: StopStudySessionResult["taskUpdated"] = null;
  if (session.task_id) {
    const { data: taskRow } = await supabase
      .from("day_tasks")
      .select("id, title, description, progress_pct, completed_at, goal_id")
      .eq("id", session.task_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (taskRow) {
      const { estMinutes } = parseTaskDescription(taskRow.description);
      const oldProgress = taskRow.progress_pct ?? 0;
      let deltaPct = 0;

      if (estMinutes && estMinutes > 0) {
        // Proportion of estimated minutes spent in this session
        deltaPct = Math.round((durationSeconds / 60 / estMinutes) * 100);
      } else {
        // Default: 25 minutes = 25% (1 unit block)
        deltaPct = Math.round((durationSeconds / 60 / 25) * 25);
      }
      if (deltaPct < 1 && durationSeconds >= 60) deltaPct = 1;

      const newProgress = Math.min(100, Math.max(0, oldProgress + deltaPct));
      const shouldComplete =
        input.markTaskComplete === true || (input.markTaskComplete !== false && newProgress >= 100);

      const taskPatch: TablesUpdate<"day_tasks"> = {
        progress_pct: shouldComplete ? 100 : newProgress,
      };

      if (shouldComplete && !taskRow.completed_at) {
        taskPatch.completed_at = endedAt.toISOString();
      }

      await supabase.from("day_tasks").update(taskPatch).eq("id", taskRow.id).eq("user_id", userId);

      if (shouldComplete) {
        await recomputeStats(supabase, userId);
      }

      taskUpdated = {
        id: taskRow.id,
        title: taskRow.title,
        oldProgressPct: oldProgress,
        newProgressPct: taskPatch.progress_pct ?? newProgress,
        deltaPct,
        completed: shouldComplete || !!taskRow.completed_at,
      };
    }
  }

  return {
    session: savedSession,
    taskUpdated,
  };
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

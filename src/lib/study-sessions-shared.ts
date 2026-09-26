// Shared (client + server) values for the study session timer. Mirrors the
// habits-shared / subjects-shared split: pure types and helpers only — no
// Supabase or server-only imports, so this module is safe to bundle client-side.

export const STUDY_SESSION_MODES = ["pomodoro", "stopwatch", "countdown"] as const;

export type StudySessionMode = (typeof STUDY_SESSION_MODES)[number];

export type StudySession = {
  id: string;
  user_id: string;
  subject_id: string | null;
  goal_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  mode: StudySessionMode;
  target_seconds: number | null;
  notes: string | null;
  created_at: string;
};

/** A session is active while it has not been stopped yet (ended_at IS NULL). */
export function isSessionActive(session: StudySession | null | undefined): boolean {
  return !!session && session.ended_at === null;
}

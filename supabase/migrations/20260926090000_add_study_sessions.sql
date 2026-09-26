-- Study session timer: one row per timed study block, optionally tagged with a
-- subject and/or a goal.
--
-- mode/target_seconds record how the timer was run (Pomodoro, free stopwatch or
-- countdown to a target) and are fixed at start time; duration_seconds is
-- stamped when the session is stopped (see src/lib/study-sessions.server.ts).
--
-- A session is ACTIVE while ended_at IS NULL. The server enforces "at most one
-- active session per user" (a start request while one is running returns that
-- session instead of inserting a second row); the partial unique index below is
-- the database-level backstop for the same rule.

CREATE TABLE IF NOT EXISTS public.study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  mode text NOT NULL DEFAULT 'pomodoro' CHECK (mode IN ('pomodoro', 'stopwatch', 'countdown')),
  target_seconds integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_sessions TO authenticated;
GRANT ALL ON public.study_sessions TO service_role;

ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own study sessions" ON public.study_sessions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Session history / stats reads, newest first.
CREATE INDEX IF NOT EXISTS study_sessions_user_started_idx
  ON public.study_sessions (user_id, started_at DESC);

-- At most one unfinished session per user (the "one active timer" rule).
CREATE UNIQUE INDEX IF NOT EXISTS study_sessions_one_active_idx
  ON public.study_sessions (user_id) WHERE ended_at IS NULL;

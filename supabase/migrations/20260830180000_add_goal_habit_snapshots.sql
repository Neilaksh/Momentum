-- Goal habit hit-rate snapshots: frozen per-habit weekly hit-rate stats taken
-- at the exact moment a goal transitions to 'completed', so the goal card can
-- keep showing completion-time stats even though the linked habits keep
-- running (and keep counting) everywhere else in the app.
-- One row per (goal, habit); a later re-completion upserts over the old
-- snapshot via the unique constraint.

CREATE TABLE public.goal_habit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  habit_id uuid NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  weeks_on_target integer NOT NULL,
  total_weeks integer NOT NULL,
  hit_rate_pct integer NOT NULL,
  snapshotted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (goal_id, habit_id)
);

-- RLS: users may only see/modify snapshots whose owning goal is theirs
-- (the table has no user_id column of its own, so scope via the goal).
ALTER TABLE public.goal_habit_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own goal habit snapshots" ON public.goal_habit_snapshots
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.goals g
      WHERE g.id = goal_id AND g.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.goals g
      WHERE g.id = goal_id AND g.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_habit_snapshots TO authenticated;
GRANT ALL ON public.goal_habit_snapshots TO service_role;

CREATE INDEX goal_habit_snapshots_goal_idx ON public.goal_habit_snapshots (goal_id);
CREATE INDEX goal_habit_snapshots_habit_idx ON public.goal_habit_snapshots (habit_id);

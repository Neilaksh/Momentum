-- Many-to-many goal <-> habit links.
--
-- Previously habits.goal_id (a single FK column) allowed a habit to belong to
-- only one goal. goal_habit_links allows the same habit to support several
-- goals at once; each goal computes its own hit-rate for the habit using its
-- own created_at as the week-window start, so two goals sharing a habit can
-- legitimately show different percentages.
--
-- RLS is scoped through the owning goal's user_id (no user_id column of its
-- own), matching the goal_habit_snapshots pattern.

CREATE TABLE public.goal_habit_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  habit_id uuid NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (goal_id, habit_id)
);

ALTER TABLE public.goal_habit_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own goal habit links" ON public.goal_habit_links
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_habit_links TO authenticated;
GRANT ALL ON public.goal_habit_links TO service_role;

CREATE INDEX goal_habit_links_goal_idx ON public.goal_habit_links (goal_id);
CREATE INDEX goal_habit_links_habit_idx ON public.goal_habit_links (habit_id);

-- Backfill 1: every habit with the old single-FK goal_id becomes a link row.
INSERT INTO public.goal_habit_links (goal_id, habit_id)
SELECT h.goal_id, h.id
FROM public.habits h
WHERE h.goal_id IS NOT NULL
ON CONFLICT (goal_id, habit_id) DO NOTHING;

-- Backfill 2: legacy "[goal:<uuid>]" title-prefix links also become link rows
-- (only when the referenced goal still exists, so the FK is satisfied).
INSERT INTO public.goal_habit_links (goal_id, habit_id)
SELECT (regexp_match(h.title, '^\[goal:([^\]]+)\]'))[1]::uuid, h.id
FROM public.habits h
WHERE h.title ~ '^\[goal:[^\]]+\]'
  AND EXISTS (
    SELECT 1 FROM public.goals g
    WHERE g.id = (regexp_match(h.title, '^\[goal:([^\]]+)\]'))[1]::uuid
  )
ON CONFLICT (goal_id, habit_id) DO NOTHING;

-- Drop the single-goal column: the join table is now the sole source of truth
-- (fully backfilled above), and keeping a dead column would invite drift.
ALTER TABLE public.habits DROP COLUMN goal_id;

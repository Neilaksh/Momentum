-- Link habits to goals via a real foreign-key column so goal progress can
-- include habit consistency (the same pattern already used by
-- day_tasks.goal_id and routine_tasks.goal_id).

ALTER TABLE public.habits
  ADD COLUMN goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL;

CREATE INDEX habits_goal_id_idx ON public.habits (goal_id);

-- Optional backfill: existing habits linked via the legacy "[goal:<uuid>]"
-- title-prefix convention get the new column populated too (only when the
-- referenced goal still exists so the FK is satisfied).
UPDATE public.habits h
SET goal_id = (regexp_match(h.title, '^\[goal:([^\]]+)\]'))[1]::uuid
WHERE h.title ~ '^\[goal:[^\]]+\]'
  AND EXISTS (
    SELECT 1 FROM public.goals g
    WHERE g.id = (regexp_match(h.title, '^\[goal:([^\]]+)\]'))[1]::uuid
  );
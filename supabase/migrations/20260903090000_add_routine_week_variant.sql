-- Whole-week alternate routines: two independent weekly schedules per user.
-- Each routine_tasks row belongs to exactly one week ("primary" or "alternate").
-- The profile stores which week the user is currently viewing/editing.

ALTER TABLE public.routine_tasks
  ADD COLUMN week_variant text NOT NULL DEFAULT 'primary';
CREATE INDEX routine_tasks_week_variant_idx ON public.routine_tasks(user_id, week_variant);

ALTER TABLE public.profiles
  ADD COLUMN active_routine_variant text NOT NULL DEFAULT 'primary';
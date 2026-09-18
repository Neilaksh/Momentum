-- Per-day on/off switches for the weekly routine (Routines → Edit → day toggles).
--
-- A day switched off stays fully intact in routine_tasks (nothing is deleted, so
-- it comes straight back when the day is switched on again) but is excluded from
-- every derived number: weekly scheduled hours, per-day load, the category
-- breakdown and the planned-sleep estimate. A night whose bedtime or wake anchor
-- falls on a day off is simply unmeasured instead of being invented.
--
-- Stored per week-variant ("primary"/"alternate") so each whole-week schedule
-- keeps its own days off, as an array of weekday numbers (0=Mon … 6=Sun), e.g.
-- {"primary":[6],"alternate":[]}.

ALTER TABLE public.profiles
  ADD COLUMN routine_days_off jsonb NOT NULL DEFAULT '{"primary":[],"alternate":[]}'::jsonb;
-- Task priority for the Tasks tab, mirroring the goal priority feature
-- (goals encode priority in their title prefix "[p:High] ...", but task titles
-- are identity-bearing — rollover chains, dedupe keys and the routine-title
-- bracket format all parse/match on them — so tasks store priority in a real
-- column instead).
-- Nullable with no default: NULL means "None", so existing tasks are unaffected.
ALTER TABLE public.day_tasks ADD COLUMN priority text;

ALTER TABLE public.day_tasks
  ADD CONSTRAINT day_tasks_priority_check
  CHECK (priority IN ('High', 'Med', 'Low'));
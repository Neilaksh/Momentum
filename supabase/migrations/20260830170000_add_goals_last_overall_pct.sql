-- Store the last computed overall progress percentage (0-100) for each goal so
-- that the auto-complete logic in getGoals only fires on the genuine
-- "<100% -> 100%" transition instead of on every read. Without this snapshot,
-- manually reopening a goal whose linked tasks/habits are still at 100% gets
-- instantly re-completed on the next fetch.
ALTER TABLE public.goals ADD COLUMN last_overall_pct integer;

-- Backfill: a completed goal's last-known computed overall is 100 (auto-completed)
-- or was manually completed; either way "100" is the correct snapshot and prevents
-- a spurious auto-complete the first time the user reopens such a goal.
UPDATE public.goals SET last_overall_pct = 100 WHERE status = 'completed';

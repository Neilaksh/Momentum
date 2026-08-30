-- One-time cleanup: collapse duplicate goal-linked day_tasks rows.
--
-- A single goal task could end up as multiple rows for the same
-- (user_id, task_date, goal_id, title) because the rollover path and the
-- goal-scheduling / weekly-materialize paths each inserted their own copy
-- (using different routine_task_id values, or none) before the dedupe guards
-- were added to carryForwardIncompleteTasks, materializeWeek and
-- scheduleGoalTasks.
--
-- For each duplicate group we keep the most valuable row:
--   1. a completed one, if any
--   2. otherwise the row carrying progress (progress_pct > 0)
--   3. otherwise the routine-linked row (preserves future sync identity)
--   4. otherwise the highest rollover_count, then the most recently created
--
-- Scope options:
--   * run as-is: dedupe every date,
--   * add `WHERE d.task_date = CURRENT_DATE` to only clean today.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, task_date, goal_id, lower(trim(title))
      ORDER BY
        (completed_at IS NOT NULL) DESC,
        (progress_pct > 0) DESC,
        (routine_task_id IS NOT NULL) DESC,
        rollover_count DESC,
        created_at DESC,
        id
    ) AS rn
  FROM public.day_tasks
  WHERE goal_id IS NOT NULL
)
DELETE FROM public.day_tasks d
USING ranked r
WHERE d.id = r.id AND r.rn > 1;
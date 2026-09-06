-- Merge duplicate rollover identities: plain rows (goal_id IS NULL) and
-- goal-linked rows that share (user_id, normalized title) are the same task to
-- the user, but the rollover engine used to treat them as two independent
-- identities (titleKey split). This put TWO copies of the same title on a day
-- (one plain, one goal-linked, wearing different subject/priority badges) and
-- let an unchanged identity keep rolling after the other was completed.
--
-- This migration dedupes the existing duplicates. Goal-linked rows are always
-- canonical: they feed goal progress and carry the full chain identity.
--
-- Fire-and-forget, idempotent; safe to re-run. The known tradeoff (same as the
-- earlier dedupe migration 20260830090000): recomputed historical totals/XP can
-- drop slightly because completed duplicate rows are removed.

BEGIN;

-- 1) Same-day plain-vs-plain dedupe at title level (completion-aware): keep the
--    completed row if any; otherwise keep the newest incomplete row.
WITH rank_candidates AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, task_date, lower(btrim(title))
      ORDER BY
        (completed_at IS NOT NULL) DESC,
        created_at DESC,
        id
    ) AS keep_rank
  FROM public.day_tasks
  WHERE goal_id IS NULL
)
DELETE FROM public.day_tasks d
USING rank_candidates r
WHERE d.id = r.id
  AND r.keep_rank > 1;

-- 2) Copy the earliest plain completion onto the canonical goal-linked row, so
--    a task completed through the plain identity reads as done everywhere.
UPDATE public.day_tasks g
SET completed_at = earliest.completed_at,
    progress_pct  = greatest(g.progress_pct, 100)
FROM (
  SELECT p.user_id, p.task_date, lower(btrim(p.title)) AS title, min(p.completed_at) AS completed_at
  FROM public.day_tasks p
  WHERE p.goal_id IS NULL
    AND p.completed_at IS NOT NULL
  GROUP BY p.user_id, p.task_date, lower(btrim(p.title))
) earliest
JOIN public.day_tasks g2 ON g2.user_id = earliest.user_id
                        AND g2.task_date = earliest.task_date
                        AND lower(btrim(g2.title)) = earliest.title
WHERE g.id = g2.id
  AND g.goal_id IS NOT NULL
  AND g.completed_at IS NULL;

-- 3) Delete plain rows that share a day + title with a goal-linked row. Step 2
--    already preserved the completion; progress/priority of the goal row wins.
--    A plain row that is the ONLY same-title survivor on its day is kept.
DELETE FROM public.day_tasks d
WHERE d.goal_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.day_tasks g
    WHERE g.user_id = d.user_id
      AND g.task_date = d.task_date
      AND lower(btrim(g.title)) = lower(btrim(d.title))
      AND g.goal_id IS NOT NULL
  );

-- 4) Cross-day zombie cleanup: an uncompleted plain row that a same-title
--    goal-linked row supersedes on a LATER date is dead weight (the goal chain
--    now represents the task). Only rows strictly before the later goal row are
--    removed, so future dates remain untouched.
DELETE FROM public.day_tasks d
WHERE d.goal_id IS NULL
  AND d.completed_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.day_tasks g
    WHERE g.user_id = d.user_id
      AND g.goal_id IS NOT NULL
      AND lower(btrim(g.title)) = lower(btrim(d.title))
      AND g.task_date > d.task_date
  );

COMMIT;
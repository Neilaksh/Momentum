WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, task_date, goal_id, lower(trim(coalesce(title, '')))
      ORDER BY
        (completed_at IS NOT NULL) DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM public.day_tasks
  WHERE goal_id IS NOT NULL
)
DELETE FROM public.day_tasks d
USING ranked r
WHERE d.id = r.id AND r.rn > 1;
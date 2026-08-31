-- Optional per-link tracking window on goal_habit_links.
--
-- When duration_days is NULL, the goal tracks the linked habit for its whole
-- life (current behavior: unlimited window from the link's created_at).
-- When set, tracking is capped to `duration_days` days starting from the
-- link's created_at; Monday weeks whose start falls outside that window no
-- longer contribute to the habit's hit-rate for this goal.

ALTER TABLE public.goal_habit_links ADD COLUMN duration_days integer;
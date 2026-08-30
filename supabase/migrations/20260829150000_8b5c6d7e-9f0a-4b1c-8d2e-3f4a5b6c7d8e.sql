-- Add description, progress tracking, rollover count, and stale flag to day_tasks
ALTER TABLE public.day_tasks ADD COLUMN description text;
ALTER TABLE public.day_tasks ADD COLUMN progress_pct integer NOT NULL DEFAULT 0;
ALTER TABLE public.day_tasks ADD COLUMN rollover_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.day_tasks ADD COLUMN is_stale boolean NOT NULL DEFAULT false;

-- Index for efficient stale task queries
CREATE INDEX day_tasks_stale_idx ON public.day_tasks(user_id, is_stale) WHERE is_stale = true;

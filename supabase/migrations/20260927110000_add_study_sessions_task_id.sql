-- Link study sessions to a day_task so timers, stopwatches, and pomodoros can
-- update task progress and inherit its goal and subject.

ALTER TABLE public.study_sessions
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.day_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS study_sessions_task_id_idx
  ON public.study_sessions (task_id);

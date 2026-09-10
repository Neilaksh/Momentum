-- Exam Schedules: Track scheduled examinations per subject, scoped to the owning user.

CREATE TABLE IF NOT EXISTS public.exam_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  title text NOT NULL,
  exam_date date NOT NULL,
  start_time text,
  end_time text,
  location text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_schedules TO authenticated;
GRANT ALL ON public.exam_schedules TO service_role;

ALTER TABLE public.exam_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own exam schedules" ON public.exam_schedules
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS exam_schedules_user_date_idx ON public.exam_schedules (user_id, exam_date ASC);
CREATE INDEX IF NOT EXISTS exam_schedules_subject_idx ON public.exam_schedules (subject_id);

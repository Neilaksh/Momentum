CREATE TABLE public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'lime',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subjects TO authenticated;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subjects" ON public.subjects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX subjects_user_idx ON public.subjects(user_id);
CREATE TRIGGER subjects_updated BEFORE UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.day_tasks ADD COLUMN subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;
CREATE INDEX day_tasks_subject_idx ON public.day_tasks(subject_id);

ALTER TABLE public.routine_tasks ADD COLUMN subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;
CREATE INDEX routine_tasks_subject_idx ON public.routine_tasks(subject_id);

-- Alternate routines: rows sharing a variant_key form an alternate pair/group
-- (original + alternate); exactly one variant of the pair is active at a time.
ALTER TABLE public.routine_tasks ADD COLUMN variant_key text;
CREATE INDEX routine_tasks_variant_idx ON public.routine_tasks(user_id, variant_key);
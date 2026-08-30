-- Weekly Reviews: per-week reflection summaries, scoped to the owning user.

CREATE TABLE public.weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  reflection_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_reviews TO authenticated;
GRANT ALL ON public.weekly_reviews TO service_role;
ALTER TABLE public.weekly_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own weekly reviews" ON public.weekly_reviews
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX weekly_reviews_user_date_idx ON public.weekly_reviews (user_id, week_start_date DESC);

-- Track the last Monday (week start) for which the user has seen the review, so the
-- weekly prompt does not repeat once dismissed.
ALTER TABLE public.profiles ADD COLUMN last_seen_review_week date;

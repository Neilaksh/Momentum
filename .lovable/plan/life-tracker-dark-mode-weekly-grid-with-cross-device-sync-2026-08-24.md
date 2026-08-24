# Life Tracker — dark-mode weekly grid with cross-device sync

A gamified weekly task tracker inspired by the spreadsheet in your video: a row of day cards (Mon–Sun), each with its own checklist and a completion ring, plus an overall weekly progress chart — rebuilt as a real dark-mode app that syncs across every device you sign in on.

## Screens

**Auth (`/auth`)** — email + password sign up / sign in, with password reset. Everything else requires an account.

**Week board (`/`)** — the main screen.
- Seven day cards in a horizontally scrolling row (stacked on mobile), each showing the date, a donut ring with % complete, and its checklist with tick boxes.
- Add a one-off task to any single day inline.
- Header: week navigation (prev / this week / next), overall completion donut ("34 / 60 completed"), and a bar chart of tasks completed per day.
- Top-right: current streak, level, and XP bar.

**Routine (`/routine`)** — the recurring weekly template. Define tasks per weekday once; they auto-appear on every week. Editing the template affects future weeks only, not already-ticked history.

**Goals (`/goals`)** — long-term goals with a target date. Each task (template or one-off) can be linked to a goal; each goal shows a progress bar from its completed linked tasks.

**History (`/history`)** — past weeks list with completion %, plus a trend chart over recent weeks and lifetime stats (best streak, total tasks done, total XP).

## Gamification

- +10 XP per task completed, +50 bonus for a 100% day.
- Levels from cumulative XP on a rising curve; level + progress bar shown in the header.
- Streak = consecutive days with at least one task completed; current and best streak tracked.

## Design

Dark mode only: near-black background, layered charcoal cards with subtle borders, one bright accent (electric lime-green) for rings, checks and XP. Tabular/mono numerals for stats, clean geometric sans for headings, generous spacing, smooth ring and check animations. No purple gradients.

## Technical notes

Lovable Cloud (auth + Postgres) provides the sync — data lives server-side, so signing in on phone and laptop shows the same state.

Tables (all RLS-scoped to `auth.uid()`, with grants):
- `profiles` — display name, total XP, level, current/best streak
- `goals` — title, description, target date, status
- `routine_tasks` — weekday (0–6), title, order, optional `goal_id`, active flag
- `day_tasks` — date, title, order, `source` (routine | oneoff), optional `routine_task_id`, optional `goal_id`, `completed_at`

Opening a week materializes that week's `day_tasks` from the active routine template (idempotent, server-side), so ticking a box is a simple row update. Reads go through route loaders + TanStack Query with optimistic ticking; XP/streak recalculated server-side on each completion change.

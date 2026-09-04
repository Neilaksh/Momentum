import type { SupabaseClient } from "@supabase/supabase-js";
import { getSubjectBreakdown } from "./subjects.server";
import {
  addDays,
  parseISODate,
  startOfWeek,
  toISODate,
  weekDates,
  WEEKDAY_NAMES,
  XP_PER_TASK,
  XP_PERFECT_DAY,
} from "./tracker-shared";
import type {
  ReviewPromptStatus,
  WeekReviewGoal,
  WeekReviewHabit,
  WeekReviewStreakStatus,
  WeeklyReview,
} from "./weekly-review-shared";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

/**
 * Length of the streak (consecutive days each with ≥1 completed task) as of the
 * given cutoff, allowing the cutoff day itself or the day before to keep the run
 * alive — mirroring the `currentStreak` logic used across the app.
 */
function streakAsOf(activeDays: string[], cutoff: Date): number {
  const set = new Set(activeDays);
  let cursor = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate());
  if (!set.has(toISODate(cursor))) cursor = addDays(cursor, -1);
  let run = 0;
  while (set.has(toISODate(cursor))) {
    run += 1;
    cursor = addDays(cursor, -1);
  }
  return run;
}

export async function getWeeklyReview(supabase: DB, userId: string, weekStart: string): Promise<WeeklyReview> {
  const dates = weekDates(weekStart);

  const [taskRes, habitRes, logRes, goalRes, reviewRes, profileRes, subjectEntries] = await Promise.all([
    supabase.from("day_tasks").select("task_date, completed_at").eq("user_id", userId),
    supabase
      .from("habits")
      .select("id, title, color, target_per_week")
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true }),
    supabase
      .from("habit_logs")
      .select("habit_id, log_date")
      .eq("user_id", userId)
      .gte("log_date", dates[0]!)
      .lte("log_date", dates[6]!),
    supabase.from("goals").select("id, title, status, color, created_at, updated_at").eq("user_id", userId),
    supabase
      .from("weekly_reviews")
      .select("reflection_text")
      .eq("user_id", userId)
      .eq("week_start_date", weekStart)
      .maybeSingle(),
    supabase.from("profiles").select("current_streak, best_streak").eq("id", userId).maybeSingle(),
    getSubjectBreakdown(supabase, userId, dates[0]!, dates[6]!),
  ]);

  const taskRows = taskRes.data ?? [];
  const habits = habitRes.data ?? [];
  const logs = logRes.data ?? [];
  const goals = goalRes.data ?? [];
  const profile = profileRes.data ?? null;

  // --- Per-day completions + XP for the week ---
  const byDate = new Map<string, { total: number; done: number }>();
  for (const r of taskRows) {
    const e = byDate.get(r.task_date) ?? { total: 0, done: 0 };
    e.total += 1;
    if (r.completed_at) e.done += 1;
    byDate.set(r.task_date, e);
  }
  const allActive = [...byDate.entries()]
    .filter(([, e]) => e.done > 0)
    .map(([d]) => d)
    .sort();

  let totalTasks = 0;
  let completedTasks = 0;
  let xpEarned = 0;
  const daily = dates.map((date, i) => {
    const e = byDate.get(date) ?? { total: 0, done: 0 };
    totalTasks += e.total;
    completedTasks += e.done;
    xpEarned += e.done * XP_PER_TASK;
    if (e.total > 0 && e.done === e.total) xpEarned += XP_PERFECT_DAY;
    return { date, label: WEEKDAY_NAMES[i]!.slice(0, 3), done: e.done, total: e.total };
  });

  const completionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // --- Streak status ---
  const activeInWeek = dates.filter((d) => (byDate.get(d)?.done ?? 0) > 0).length;
  const endOfPrevWeek = addDays(parseISODate(weekStart), -1);
  const weekSun = parseISODate(dates[6]!);
  const streakAtStart = streakAsOf(allActive, endOfPrevWeek);
  const streakAsOfEnd = streakAsOf(allActive, weekSun);
  let streakStatus: WeekReviewStreakStatus = "none";
  if (activeInWeek > 0) {
    if (streakAsOfEnd > streakAtStart) streakStatus = "extended";
    else if (streakAsOfEnd === streakAtStart) streakStatus = "maintained";
    else streakStatus = "broken";
  }



  // --- Habits ---
  const doneByHabit = new Map<string, string[]>();
  for (const l of logs) {
    const arr = doneByHabit.get(l.habit_id) ?? [];
    arr.push(l.log_date);
    doneByHabit.set(l.habit_id, arr);
  }
  const weekHabits: WeekReviewHabit[] = habits.map((h) => {
    const done = doneByHabit.get(h.id)?.length ?? 0;
    const target = Math.max(1, h.target_per_week);
    return {
      id: h.id,
      title: h.title,
      color: h.color,
      target,
      done,
      pct: target ? Math.round((Math.min(done, target) / target) * 100) : 0,
    };
  });
  const habitDone = weekHabits.reduce((a, h) => a + Math.min(h.done, h.target), 0);
  const habitTarget = weekHabits.reduce((a, h) => a + h.target, 0);
  const habitRate = habitTarget ? Math.round((habitDone / habitTarget) * 100) : 0;

  // --- Goals with status changes / newly completed that week ---
  const weekStartDate = parseISODate(weekStart);
  const weekStartMin = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate(), 0, 0, 0);
  const weekEndDate = parseISODate(dates[6]!);
  const weekEndMax = new Date(weekEndDate.getFullYear(), weekEndDate.getMonth(), weekEndDate.getDate(), 23, 59, 59, 999);
  const weekGoals: WeekReviewGoal[] = [];
  for (const g of goals) {
    const created = new Date(g.created_at);
    const updated = new Date(g.updated_at);
    const updatedThisWeek = updated >= weekStartMin && updated <= weekEndMax;
    if (!updatedThisWeek) continue;
    weekGoals.push({
      id: g.id,
      title: g.title,
      status: g.status,
      color: g.color,
      isNewlyCompleted: g.status === "completed" && updatedThisWeek,
      isNewlyCreated: created >= weekStartMin && created <= weekEndMax,
    });
  }

  return {
    weekStart,
    weekEnd: dates[6]!,
    totalTasks,
    completedTasks,
    completionRate,
    daily,
    xpEarned,
    streakStatus,
    activeDaysInWeek: activeInWeek,
    streakAsOfEnd,
    currentStreak: profile?.current_streak ?? 0,
    bestStreak: profile?.best_streak ?? 0,
    habits: weekHabits,
    habitDone,
    habitTarget,
    habitRate,
    goals: weekGoals.sort((a, b) => Number(b.isNewlyCompleted) - Number(a.isNewlyCompleted)),
    subjects: subjectEntries,
    reflection: reviewRes.data?.reflection_text ?? null,
  };
}


/** Distinct Monday week-starts that have any tracked data or a saved review, newest first. */
export async function listWeeklyReviews(supabase: DB, userId: string): Promise<string[]> {
  const [tasks, logs, reviews] = await Promise.all([
    supabase.from("day_tasks").select("task_date").eq("user_id", userId),
    supabase.from("habit_logs").select("log_date").eq("user_id", userId),
    supabase.from("weekly_reviews").select("week_start_date").eq("user_id", userId),
  ]);

  const weeks = new Set<string>();
  const addWeek = (iso: string) => {
    try {
      weeks.add(toISODate(startOfWeek(parseISODate(iso))));
    } catch {
      /* ignore malformed */
    }
  };
  for (const r of tasks.data ?? []) addWeek(r.task_date);
  for (const r of logs.data ?? []) addWeek(r.log_date);
  for (const r of reviews.data ?? []) addWeek(r.week_start_date);

  // Only weeks that have fully passed — exclude the current in-progress week
  // (and any future-dated data).
  const currentWeekStart = toISODate(startOfWeek(new Date()));
  return [...weeks]
    .filter((w) => w < currentWeekStart)
    .sort((a, b) => (a < b ? 1 : -1));
}

/** Should we prompt the user to view last week's review (only true on a Monday). */
export async function getReviewPromptStatus(
  supabase: DB,
  userId: string,
  options?: { force?: boolean },
): Promise<ReviewPromptStatus> {
  const today = new Date();
  const day = (today.getDay() + 6) % 7; // 0 = Monday
  const isMonday = day === 0;
  const thisWeekStart = toISODate(startOfWeek(today));
  const prevWeekStart = toISODate(addDays(parseISODate(thisWeekStart), -7));

  // Dev-only preview hook (WeeklyReviewBanner passes this when the URL contains
  // ?review-preview in development) — bypasses the Monday and last-seen checks.
  if (options?.force) return { shouldShow: true, weekStart: prevWeekStart, isMonday };

  if (!isMonday) return { shouldShow: false, weekStart: prevWeekStart, isMonday };

  const { data } = await supabase
    .from("profiles")
    .select("last_seen_review_week")
    .eq("id", userId)
    .maybeSingle();

  const lastSeen =
    (data as { last_seen_review_week: string | null } | null)?.last_seen_review_week ?? null;
  const shouldShow = !lastSeen || lastSeen < prevWeekStart;
  return { shouldShow, weekStart: prevWeekStart, isMonday };
}

/** Mark the given week's review as seen so the Monday prompt doesn't repeat. */
export async function markReviewSeen(supabase: DB, userId: string, weekStart: string): Promise<void> {
  await supabase.from("profiles").update({ last_seen_review_week: weekStart }).eq("id", userId);
}

/** Upsert the one-line reflection for a week. */
export async function saveWeeklyReflection(
  supabase: DB,
  userId: string,
  weekStart: string,
  reflectionText: string,
): Promise<void> {
  await supabase
    .from("weekly_reviews")
    .upsert(
      { user_id: userId, week_start_date: weekStart, reflection_text: reflectionText.trim() },
      { onConflict: "user_id,week_start_date" },
    );
}


import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, parseISODate, toISODate, weekDates } from "./tracker-shared";
import type { HabitStat, HabitsData } from "./habits-shared";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

/** Number of whole-ish weeks elapsed in the window [from, to] inclusive, as a fraction. */
function weeksBetween(from: Date, to: Date): number {
  const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  return Math.max(0, days) / 7;
}

function currentStreak(doneSet: Set<string>, today: Date): number {
  let streak = 0;
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // today not yet done shouldn't break a streak that ran through yesterday
  if (!doneSet.has(toISODate(cursor))) cursor = addDays(cursor, -1);
  while (doneSet.has(toISODate(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function calculateBestStreak(doneSet: Set<string>): number {
  if (doneSet.size === 0) return 0;
  const sorted = Array.from(doneSet).sort();
  let best = 1;
  let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseISODate(sorted[i - 1]!);
    const next = parseISODate(sorted[i]!);
    const diff = Math.round((next.getTime() - prev.getTime()) / 86400000);
    if (diff === 1) {
      cur += 1;
      if (cur > best) best = cur;
    } else if (diff > 1) {
      cur = 1;
    }
  }
  return best;
}

export async function loadHabits(
  supabase: DB,
  userId: string,
  weekStart: string,
): Promise<HabitsData> {
  const dates = weekDates(weekStart);
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const yearStartISO = toISODate(yearStart);

  const { data: habitRows } = await supabase
    .from("habits")
    .select("*")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const habits = habitRows ?? [];

  const rangeStart = yearStartISO < dates[0]! ? yearStartISO : dates[0]!;
  const rangeEnd = toISODate(today) > dates[6]! ? toISODate(today) : dates[6]!;

  const { data: logRows } = await supabase
    .from("habit_logs")
    .select("habit_id, log_date")
    .eq("user_id", userId)
    .gte("log_date", rangeStart)
    .lte("log_date", rangeEnd);

  const logs = logRows ?? [];
  const byHabit = new Map<string, Set<string>>();
  for (const l of logs) {
    const set = byHabit.get(l.habit_id) ?? new Set<string>();
    set.add(l.log_date);
    byHabit.set(l.habit_id, set);
  }

  const stats: HabitStat[] = habits.map((habit) => {
    const done = byHabit.get(habit.id) ?? new Set<string>();
    const weekDone = dates.filter((d) => done.has(d)).length;
    const weekTarget = Math.max(1, habit.target_per_week);

    // Year window starts at the later of Jan 1 and the habit's creation date.
    const created = parseISODate(habit.created_at.slice(0, 10));
    const from = created > yearStart ? created : yearStart;
    const yearDone = [...done].filter((d) => d >= toISODate(from) && d >= yearStartISO).length;
    const yearTarget = Math.max(1, Math.round(weeksBetween(from, today) * weekTarget));
    const curStreak = currentStreak(done, today);
    const bStreak = Math.max(curStreak, calculateBestStreak(done));

    return {
      habit,
      weekDone,
      weekTarget,
      weekPct: Math.round((Math.min(weekDone, weekTarget) / weekTarget) * 100),
      yearDone,
      yearTarget,
      yearPct: Math.round((Math.min(yearDone, yearTarget) / yearTarget) * 100),
      streak: curStreak,
      bestStreak: bStreak,
      doneDates: Array.from(done),
    };
  });

  const weekDone = stats.reduce((a, s) => a + Math.min(s.weekDone, s.weekTarget), 0);
  const weekTarget = stats.reduce((a, s) => a + s.weekTarget, 0);
  const yearDone = stats.reduce((a, s) => a + Math.min(s.yearDone, s.yearTarget), 0);
  const yearTarget = stats.reduce((a, s) => a + s.yearTarget, 0);

  return {
    weekStart,
    dates,
    stats,
    totals: {
      weekDone,
      weekTarget,
      weekPct: weekTarget ? Math.round((weekDone / weekTarget) * 100) : 0,
      yearDone,
      yearTarget,
      yearPct: yearTarget ? Math.round((yearDone / yearTarget) * 100) : 0,
    },
  };
}

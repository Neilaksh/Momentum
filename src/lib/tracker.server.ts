import type { SupabaseClient } from "@supabase/supabase-js";
import {
  XP_PER_TASK,
  XP_PERFECT_DAY,
  levelFromXp,
  parseISODate,
  toISODate,
  weekDates,
  type DayTask,
  type Profile,
  type WeekData,
} from "./tracker-shared";

type DB = SupabaseClient<any, "public", any>;

export async function ensureProfile(supabase: DB, userId: string): Promise<Profile | null> {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (data) return data as Profile;
  const { data: created } = await supabase
    .from("profiles")
    .insert({ id: userId })
    .select("*")
    .maybeSingle();
  return (created as Profile) ?? null;
}

/** Materialize routine template tasks into day_tasks for the given week (idempotent). */
export async function materializeWeek(supabase: DB, userId: string, weekStart: string) {
  const dates = weekDates(weekStart);
  const { data: routine } = await supabase
    .from("routine_tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true);

  const { data: existing } = await supabase
    .from("day_tasks")
    .select("task_date, routine_task_id")
    .eq("user_id", userId)
    .gte("task_date", dates[0]!)
    .lte("task_date", dates[6]!);

  const have = new Set(
    (existing ?? [])
      .filter((r: any) => r.routine_task_id)
      .map((r: any) => `${r.task_date}|${r.routine_task_id}`),
  );

  const rows: Record<string, unknown>[] = [];
  for (const rt of (routine ?? []) as any[]) {
    const date = dates[rt.weekday];
    if (!date) continue;
    if (have.has(`${date}|${rt.id}`)) continue;
    rows.push({
      user_id: userId,
      task_date: date,
      title: rt.title,
      sort_order: rt.sort_order,
      source: "routine",
      routine_task_id: rt.id,
      goal_id: rt.goal_id,
    });
  }
  if (rows.length > 0) {
    await supabase.from("day_tasks").insert(rows);
  }
}

export async function loadWeek(supabase: DB, userId: string, weekStart: string): Promise<WeekData> {
  await materializeWeek(supabase, userId, weekStart);
  const dates = weekDates(weekStart);
  const { data } = await supabase
    .from("day_tasks")
    .select("*")
    .eq("user_id", userId)
    .gte("task_date", dates[0]!)
    .lte("task_date", dates[6]!)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const tasks = (data ?? []) as DayTask[];
  const profile = await ensureProfile(supabase, userId);

  return {
    weekStart,
    days: dates.map((date, i) => ({
      date,
      weekday: i,
      tasks: tasks.filter((t) => t.task_date === date),
    })),
    profile,
  };
}

/** Recompute XP, level and streaks from the full task history. */
export async function recomputeStats(supabase: DB, userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("day_tasks")
    .select("task_date, completed_at")
    .eq("user_id", userId);

  const rows = (data ?? []) as { task_date: string; completed_at: string | null }[];
  const byDate = new Map<string, { total: number; done: number }>();
  for (const r of rows) {
    const entry = byDate.get(r.task_date) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (r.completed_at) entry.done += 1;
    byDate.set(r.task_date, entry);
  }

  let xp = 0;
  const activeDays: string[] = [];
  for (const [date, e] of byDate) {
    xp += e.done * XP_PER_TASK;
    if (e.total > 0 && e.done === e.total) xp += XP_PERFECT_DAY;
    if (e.done > 0) activeDays.push(date);
  }
  activeDays.sort();

  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const d of activeDays) {
    const cur = parseISODate(d);
    if (prev && (cur.getTime() - prev.getTime()) / 86400000 === 1) run += 1;
    else run = 1;
    best = Math.max(best, run);
    prev = cur;
  }

  const today = new Date();
  const todayISO = toISODate(today);
  const yesterdayISO = toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  const last = activeDays[activeDays.length - 1];
  const current = last === todayISO || last === yesterdayISO ? run : 0;

  const { data: updated } = await supabase
    .from("profiles")
    .update({
      total_xp: xp,
      level: levelFromXp(xp),
      current_streak: current,
      best_streak: best,
      last_active_day: last ?? null,
    })
    .eq("id", userId)
    .select("*")
    .maybeSingle();

  return (updated as Profile) ?? null;
}

export async function loadHistory(supabase: DB, userId: string, weeks: number) {
  const { data } = await supabase
    .from("day_tasks")
    .select("task_date, completed_at")
    .eq("user_id", userId)
    .order("task_date", { ascending: true });

  const rows = (data ?? []) as { task_date: string; completed_at: string | null }[];
  const byWeek = new Map<string, { total: number; done: number }>();
  for (const r of rows) {
    const d = parseISODate(r.task_date);
    const offset = (d.getDay() + 6) % 7;
    const ws = toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset));
    const e = byWeek.get(ws) ?? { total: 0, done: 0 };
    e.total += 1;
    if (r.completed_at) e.done += 1;
    byWeek.set(ws, e);
  }
  const list = [...byWeek.entries()]
    .map(([weekStart, e]) => ({
      weekStart,
      total: e.total,
      done: e.done,
      pct: e.total ? Math.round((e.done / e.total) * 100) : 0,
    }))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
    .slice(0, weeks);

  const totalDone = rows.filter((r) => r.completed_at).length;
  return { weeks: list, totalDone, totalTasks: rows.length };
}

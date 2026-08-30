import type { SupabaseClient } from "@supabase/supabase-js";
import {
  XP_PER_TASK,
  XP_PERFECT_DAY,
  goalLinkKey,
  levelFromXp,
  parseISODate,
  parseRoutineTitle,
  toISODate,
  weekDates,
  type DayTask,
  type Profile,
  type WeekData,
} from "./tracker-shared";
import type { Subject } from "./subjects-shared";

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

/** Key identifying "the same task" across days. */
function taskKey(t: { title?: string | null; goal_id?: string | null; routine_task_id?: string | null }) {
  return `${(t.title ?? "").trim().toLowerCase()}|${t.goal_id ?? ""}|${t.routine_task_id ?? ""}`;
}

/** How many days in a row an uncompleted task may roll over before going stale. */
const STALE_LIMIT = 3;

/**
 * Incomplete tasks from past days stay where they are (they render as "Due"),
 * and a copy carrying the same title / description / subject / goal link / routine
 * link / progress is created for today. Works for manual dashboard tasks as well
 * as goal-scheduled tasks.
 *
 * Rollover counting: every copy inherits the parent's rollover_count, so the whole
 * chain is the same task identity. Once a task has rolled over rollover limit times
 * in a row without being completed, it is marked "Stale" (is_stale = true) and no
 * further copies are created. The most recent copy is parked into today's list so
 * the user can still see and resolve it; the original stays in its original day as
 * a historical record (only the newest copy, never the original, is ever moved).
 */
export async function carryForwardIncompleteTasks(supabase: DB, userId: string): Promise<number> {
  const todayISO = toISODate(new Date());

  const { data } = await supabase
    .from("day_tasks")
    .select("id, task_date, title, description, source, sort_order, routine_task_id, goal_id, subject_id, completed_at, progress_pct, rollover_count, is_stale")
    .eq("user_id", userId)
    .lte("task_date", todayISO);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return 0;

  const overdue = rows.filter((r) => !r.completed_at && r.task_date < todayISO && !r.is_stale);
  if (overdue.length === 0) return 0;

  // Goal tasks only carry forward while their goal is still active.
  const goalIds = [...new Set(overdue.map((r) => r.goal_id).filter(Boolean))] as string[];
  let activeGoalIds = new Set<string>();
  if (goalIds.length > 0) {
    const { data: goals } = await supabase
      .from("goals")
      .select("id, status")
      .eq("user_id", userId)
      .neq("status", "completed")
      .in("id", goalIds);
    activeGoalIds = new Set((goals ?? []).map((g: any) => g.id));
  }

  // Latest date on which each task key was actually completed.
  const lastDone = new Map<string, string>();
  for (const r of rows) {
    if (!r.completed_at) continue;
    const k = taskKey(r);
    const prev = lastDone.get(k);
    if (!prev || r.task_date > prev) lastDone.set(k, r.task_date);
  }

  const todayKeys = new Set(rows.filter((r) => r.task_date === todayISO).map(taskKey));

  // Same-goal dedupe for today: goal-linked tasks are also created by
  // materializeWeek / scheduleGoalTasks, which may use a different
  // routine_task_id (or none). Key on goal + title so the rollover never adds a
  // second row for a goal task that already exists today.
  const todayGoalKeys = new Set(
    rows
      .filter((r) => r.task_date === todayISO && r.goal_id)
      .map((r) => goalLinkKey(todayISO, r)),
  );
  const dateById = new Map<string, string>(rows.map((r) => [r.id, r.task_date]));

  // Track the oldest ("original") and newest (active copy) overdue row per task key.
  const oldestIdByKey = new Map<string, string>();
  const newestIdByKey = new Map<string, string>();
  for (const t of overdue) {
    const k = taskKey(t);
    const oldest = oldestIdByKey.get(k);
    if (!oldest || (dateById.get(t.id) ?? "") < (dateById.get(oldest) ?? "")) oldestIdByKey.set(k, t.id);
    const newest = newestIdByKey.get(k);
    if (!newest || (dateById.get(t.id) ?? "") > (dateById.get(newest) ?? "")) newestIdByKey.set(k, t.id);
  }

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: string; rollover_count: number; is_stale: boolean; parkToday?: boolean }[] = [];

  for (const t of overdue) {
    if (t.goal_id && !activeGoalIds.has(t.goal_id)) continue;
    const k = taskKey(t);
    // A copy of this task already exists for today (created by an earlier pass or
    // pre-existing). Never create a second one — otherwise every week refetch
    // would spawn a fresh zero-progress duplicate while the chain is under the
    // stale limit. The existing copy carries the chain's rollover_count already.
    if (todayKeys.has(k)) continue;
    // Goal-linked tasks: also skip if a row for the same goal + title already
    // exists today (it may have a different routine_task_id, e.g. created by
    // materializeWeek or scheduleGoalTasks).
    if (t.goal_id && todayGoalKeys.has(goalLinkKey(todayISO, t))) continue;
    // Already caught up on a later day — no need to keep dragging it forward.
    const done = lastDone.get(k);
    if (done && done > t.task_date) continue;

    const countSoFar = t.rollover_count ?? 0;
    const becomesStale = countSoFar + 1 >= STALE_LIMIT;

    if (countSoFar >= STALE_LIMIT || becomesStale) {
      // Rollover limit reached (or already reached in a previous pass): mark the
      // task stale and stop creating further copies. The newest copy gets parked
      // into today's list so it stays visible until the user resolves it.
      const isNewest = newestIdByKey.get(k) === t.id;
      const isOriginal = oldestIdByKey.get(k) === t.id;
      toUpdate.push({
        id: t.id,
        rollover_count: Math.max(countSoFar, STALE_LIMIT),
        is_stale: true,
        parkToday: isNewest && !isOriginal && !todayKeys.has(k),
      });
      continue;
    }

    // Rolling over: mark progress on this row and create the next-day copy, which
    // INHERITS the rollover count so the identity self-limits after 3 days.
    const newCount = countSoFar + 1;
    todayKeys.add(k);
    todayGoalKeys.add(goalLinkKey(todayISO, t));
    toUpdate.push({ id: t.id, rollover_count: newCount, is_stale: false });
    toInsert.push({
      user_id: userId,
      task_date: todayISO,
      title: t.title,
      description: t.description ?? null,
      sort_order: t.sort_order ?? 0,
      source: t.source ?? "oneoff",
      routine_task_id: t.routine_task_id ?? null,
      goal_id: t.goal_id ?? null,
      subject_id: t.subject_id ?? null,
      progress_pct: t.progress_pct ?? 0,
      rollover_count: newCount,
    });
  }

  // Apply rollover count / stale updates (and park the newest stale copy in today).
  for (const u of toUpdate) {
    if (u.parkToday) {
      await supabase
        .from("day_tasks")
        .update({
          task_date: todayISO,
          rollover_count: u.rollover_count,
          is_stale: u.is_stale,
        })
        .eq("id", u.id);
    } else {
      await supabase
        .from("day_tasks")
        .update({ rollover_count: u.rollover_count, is_stale: u.is_stale })
        .eq("id", u.id);
    }
  }

  if (toInsert.length > 0) {
    await supabase.from("day_tasks").insert(toInsert);
  }
  return toInsert.length;
}

/** @deprecated kept for compatibility — now copies forward instead of moving. */
export const rolloverIncompleteGoalTasks = carryForwardIncompleteTasks;


/** Materialize goal-linked repeating routine tasks into day_tasks for the given week (idempotent).
 * General routine schedule blocks (without a goal_id) are kept in the Routines tab and not placed into day_tasks.
 */
export async function materializeWeek(supabase: DB, userId: string, weekStart: string) {
  await rolloverIncompleteGoalTasks(supabase, userId);

  // Clean up any legacy unlinked routine schedule tasks from day_tasks
  await supabase
    .from("day_tasks")
    .delete()
    .eq("user_id", userId)
    .eq("source", "routine")
    .is("goal_id", null);

  const dates = weekDates(weekStart);

  // Fetch all active repeating routine tasks that are linked to goals
  const { data: goalRoutines } = await supabase
    .from("routine_tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .not("goal_id", "is", null);

  const { data: existing } = await supabase
    .from("day_tasks")
    .select("task_date, routine_task_id, goal_id, title")
    .eq("user_id", userId)
    .gte("task_date", dates[0]!)
    .lte("task_date", dates[6]!);

  const have = new Set(
    (existing ?? [])
      .filter((r: any) => r.routine_task_id)
      .map((r: any) => `${r.task_date}|${r.routine_task_id}`),
  );

  // Same-goal dedupe: a goal task may already exist on a date as a rollover copy
  // or via another routine entry with a different/null routine_task_id. Key on
  // goal + title so we never materialize a second row for the same goal task.
  const haveGoal = new Set(
    (existing ?? [])
      .filter((r: any) => r.goal_id)
      .map((r: any) => goalLinkKey(r.task_date, r)),
  );

  const rows: Record<string, unknown>[] = [];
  for (const rt of (goalRoutines ?? []) as any[]) {
    const date = dates[rt.weekday];
    if (!date) continue;
    if (have.has(`${date}|${rt.id}`)) continue;
    const parsed = parseRoutineTitle(rt.title);
    // Habits linked to goals are tracked in the Habits/Goals tabs and must not create task items in the Tasks section
    if (parsed.habitId && parsed.habitId !== "none") continue;
    const goalKey = goalLinkKey(date, { goal_id: rt.goal_id, title: parsed.displayTitle || rt.title });
    if (rt.goal_id && haveGoal.has(goalKey)) continue;
    haveGoal.add(goalKey);
    rows.push({
      user_id: userId,
      task_date: date,
      title: parsed.displayTitle || rt.title,
      sort_order: rt.sort_order ?? 0,
      source: "routine",
      routine_task_id: rt.id,
      goal_id: rt.goal_id,
      subject_id: rt.subject_id ?? null,
    });
  }

  if (rows.length > 0) {
    await supabase.from("day_tasks").insert(rows);
  }
}

export async function loadWeek(supabase: DB, userId: string, weekStart: string): Promise<WeekData> {
  await rolloverIncompleteGoalTasks(supabase, userId);
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

  const { data: subjectRows } = await supabase
    .from("subjects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return {
    weekStart,
    days: dates.map((date, i) => ({
      date,
      weekday: i,
      tasks: tasks.filter((t) => t.task_date === date),
    })),
    profile,
    subjects: (subjectRows ?? []) as Subject[],
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

/** Load a single day's tasks (materializing that day's week first) plus the profile. */
export async function loadDay(supabase: DB, userId: string, date: string) {
  const d = parseISODate(date);
  const offset = (d.getDay() + 6) % 7;
  const weekStart = toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset));
  await materializeWeek(supabase, userId, weekStart);

  const { data } = await supabase
    .from("day_tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("task_date", date)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const tasks = (data ?? []) as DayTask[];
  const profile = await ensureProfile(supabase, userId);
  const done = tasks.filter((t) => t.completed_at).length;
  return {
    date,
    tasks,
    profile,
    done,
    total: tasks.length,
    pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

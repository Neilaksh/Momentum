import { addDays, parseISODate, toISODate } from "./tracker-shared";

export type Habit = {
  id: string;
  title: string;
  color: string;
  target_per_week: number;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
};

export type HabitStat = {
  habit: Habit;
  weekDone: number;
  weekTarget: number;
  weekPct: number;
  yearDone: number;
  yearTarget: number;
  yearPct: number;
  streak: number;
  bestStreak?: number;
  doneDates: string[];
  /** Rolling-cycle window currently open (null = between cycles). */
  cycleStart: string | null;
  cycleEnd: string | null;
  cycleLocked: boolean;
};

export type HabitsData = {
  weekStart: string;
  dates: string[];
  stats: HabitStat[];
  totals: {
    weekDone: number;
    weekTarget: number;
    weekPct: number;
    yearDone: number;
    yearTarget: number;
    yearPct: number;
  };
};

export type ParsedHabitTitle = {
  cleanTitle: string;
  displayTitle: string;
  rawTitle: string;
  timeTag?: string | undefined;
};

/**
 * Goal membership used to be encoded as a "[goal:<uuid>]" title prefix; the
 * goal_habit_links join table is the source of truth now. Legacy habit titles
 * may still carry the prefix, so parse it off for display everywhere.
 * Also parses optional [time:...] tags for preferred time/reminders.
 */
export function parseHabitTitle(rawTitle: string): ParsedHabitTitle {
  if (!rawTitle) {
    return { cleanTitle: "", displayTitle: "", rawTitle: "" };
  }
  let working = rawTitle.replace(/^\[goal:[^\]]+\]\s*/, "");
  let timeTag: string | undefined;
  const timeMatch = working.match(/\[time:([^\]]+)\]/i);
  if (timeMatch) {
    timeTag = timeMatch[1]?.trim();
    working = working.replace(/\[time:[^\]]+\]/gi, "").trim();
  }
  return {
    cleanTitle: working.trim(),
    displayTitle: working.trim(),
    rawTitle,
    timeTag,
  };
}

export function formatHabitTitle(cleanTitle: string, timeTag?: string | null): string {
  const trimmed = cleanTitle.trim();
  if (timeTag && timeTag.trim()) {
    return `[time:${timeTag.trim()}] ${trimmed}`;
  }
  return trimmed;
}

// ===================== Rolling 7-day habit cycles =====================
// The Habits page tracks weekly progress as a ROLLING per-habit cycle instead
// of the fixed Monday–Sunday calendar week: a cycle starts on whichever day
// the user first checks in after the previous cycle ended and runs for
// exactly 7 days. This is purely an interpretation layer over raw habit_logs
// (habit_id, log_date) — no schema change — and it must never affect the
// Goals-side computeHabitProgress/computeGoalProgress, which keep their own
// Monday–Sunday week system.

export type HabitCycle = { start: string; end: string };

/**
 * Greedy forward-partition of check-in dates (ISO YYYY-MM-DD, any order) into
 * consecutive 7-day cycles. The first date not covered by a prior cycle starts
 * a new one; that window runs start..start+6 inclusive. A pure function of the
 * log-date SET — same logs always produce the same boundaries, and closed
 * cycles never shift as new logs arrive on/after their end. (Back-dating a
 * check-in into a gap BEFORE an existing later cycle can re-partition
 * downstream windows — accepted trade-off of the stateless model.)
 */
export function computeHabitCycles(doneDates: string[]): HabitCycle[] {
  const sorted = [...doneDates].sort();
  const cycles: HabitCycle[] = [];
  for (const d of sorted) {
    const last = cycles[cycles.length - 1];
    if (!last || d > last.end) {
      cycles.push({ start: d, end: toISODate(addDays(parseISODate(d), 6)) });
    }
  }
  return cycles;
}

/**
 * Open-cycle progress + lock state for one habit. The "current open cycle" is
 * the last partition window whose end has not passed; if the last window
 * already ended (end < today), the habit is between cycles — count resets to
 * 0 and the next check-in starts a fresh cycle. The cycle is LOCKED once its
 * check-in count reaches the target and its window still reaches today;
 * un-checks (which are never guarded) drop the count and re-unlock.
 */
export function habitCycleProgress(
  doneDates: string[],
  todayISO: string,
  target: number,
): {
  cycles: HabitCycle[];
  openCycle: HabitCycle | null;
  cycleDone: number;
  cycleLocked: boolean;
} {
  const cycles = computeHabitCycles(doneDates);
  const last = cycles[cycles.length - 1] ?? null;
  const openCycle = last && last.end >= todayISO ? last : null;
  const cycleDone = openCycle
    ? doneDates.filter((d) => d >= openCycle.start && d <= openCycle.end).length
    : 0;
  const cycleLocked = openCycle !== null && cycleDone >= Math.max(1, target);
  return { cycles, openCycle, cycleDone, cycleLocked };
}
